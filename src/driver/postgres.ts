import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import net from 'node:net';

import type { CompiledQuery } from '../compiler/index.js';
import { wrapQueryExecutionError } from '../errors/index.js';
import type {
  PostgresConnectionOptions,
  PostgresExecutor,
  QueryExecutor,
  QueryRows,
} from './types.js';

const DEFAULT_APPLICATION_NAME = 'pg-qbuild';
const UTF8 = 'utf8';
const SCRAM_MECHANISM = 'SCRAM-SHA-256';
const AUTH_OK = 0;
const AUTH_CLEARTEXT = 3;
const AUTH_MD5 = 5;
const AUTH_SASL = 10;
const AUTH_SASL_CONTINUE = 11;
const AUTH_SASL_FINAL = 12;

interface ResolvedConnectionOptions {
  readonly host?: string;
  readonly path?: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password?: string;
  readonly applicationName: string;
}

interface QueryRequest {
  readonly compiled: CompiledQuery;
  resolve(rows: QueryRows): void;
  reject(error: unknown): void;
  columns: FieldDescription[] | null;
  rows: Record<string, unknown>[];
  error: PostgresServerError | null;
}

interface FieldDescription {
  readonly name: string;
  readonly typeOid: number;
}

interface PostgresServerError {
  readonly message: string;
  readonly code?: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly position?: number;
  readonly severity?: string;
}

interface ScramState {
  readonly user: string;
  readonly password: string;
  readonly clientNonce: string;
  readonly clientFirstBare: string;
  serverFirstMessage?: string;
  expectedServerSignature?: string;
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.tail = previous.then(() => gate, () => gate);
    await previous;

    try {
      return await task();
    } finally {
      release?.();
    }
  }
}

export function createPostgresDriver(
  options: PostgresConnectionOptions = {},
): PostgresExecutor {
  return new PostgresClient(resolveConnectionOptions(options));
}

class PostgresClient implements PostgresExecutor {
  private socket: any = null;
  private buffer = Buffer.alloc(0);
  private readonly mutex = new AsyncMutex();
  private readonly decoder = new TextDecoder(UTF8);
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: unknown) => void) | null = null;
  private currentRequest: QueryRequest | null = null;
  private connected = false;
  private closing = false;
  private transactionDepth = 0;
  private savepointCounter = 0;
  private scramState: ScramState | null = null;

  constructor(private readonly options: ResolvedConnectionOptions) {}

  query(compiled: CompiledQuery): Promise<QueryRows> {
    return this.mutex.runExclusive(() => this.executeCompiled(compiled));
  }

  transaction<T>(
    callback: (executor: PostgresExecutor) => Promise<T> | T,
  ): Promise<T> {
    return this.mutex.runExclusive(() => this.runTransaction(callback));
  }

  close(): Promise<void> {
    return this.mutex.runExclusive(async () => {
      this.closing = true;
      await this.tearDownSocket();
    });
  }

  private async executeCompiled(compiled: CompiledQuery): Promise<QueryRows> {
    await this.ensureConnected();

    const sql = substituteParams(compiled.sql, compiled.params);
    return await this.sendQuery(sql, compiled);
  }

  private async runTransaction<T>(
    callback: (executor: PostgresExecutor) => Promise<T> | T,
  ): Promise<T> {
    await this.ensureConnected();

    if (this.transactionDepth === 0) {
      await this.sendSimpleCommand('BEGIN');
      this.transactionDepth = 1;

      try {
        const result = await callback(this.createUnlockedExecutor());
        await this.sendSimpleCommand('COMMIT');
        return result;
      } catch (error) {
        try {
          await this.sendSimpleCommand('ROLLBACK');
        } catch {
          // If rollback fails, preserve the original application error.
        }

        throw error;
      } finally {
        this.transactionDepth = 0;
      }
    }

    const savepointName = `pg_qbuild_sp_${++this.savepointCounter}`;
    await this.sendSimpleCommand(`SAVEPOINT ${savepointName}`);
    this.transactionDepth += 1;

    try {
      const result = await callback(this.createUnlockedExecutor());
      await this.sendSimpleCommand(`RELEASE SAVEPOINT ${savepointName}`);
      return result;
    } catch (error) {
      try {
        await this.sendSimpleCommand(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      } catch {
        // If the savepoint rollback fails, preserve the original application error.
      }

      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private createUnlockedExecutor(): PostgresExecutor {
    return {
      query: (compiled) => this.executeCompiled(compiled),
      transaction: (callback) => this.runTransaction(callback),
      close: () => this.close(),
    };
  }

  private async sendSimpleCommand(sql: string): Promise<QueryRows> {
    return await this.sendQuery(sql, { sql, params: [] });
  }

  private async sendQuery(
    sql: string,
    compiled: CompiledQuery,
  ): Promise<QueryRows> {
    const { request, promise } = await this.openRequest(compiled);

    try {
      this.writeSimpleQuery(sql);
      return await promise;
    } catch (error) {
      if (this.currentRequest === request) {
        this.currentRequest = null;
        request.reject(error);
      }

      throw wrapQueryExecutionError(error, compiled.sql, compiled.params);
    }
  }

  private async openRequest(compiled: CompiledQuery): Promise<{
    readonly request: QueryRequest;
    readonly promise: Promise<QueryRows>;
  }> {
    await this.ensureConnected();

    if (this.currentRequest !== null) {
      throw new Error('a PostgreSQL query is already in progress');
    }

    let resolve!: (rows: QueryRows) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<QueryRows>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });

    this.currentRequest = {
      compiled,
      resolve,
      reject,
      columns: null,
      rows: [],
      error: null,
    };

    return { request: this.currentRequest, promise };
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }

    if (this.connectPromise === null) {
      this.connectPromise = this.connect();
    }

    try {
      await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      this.connected = false;
      throw error;
    }
  }

  private async connect(): Promise<void> {
    const socket = await this.openSocket();

    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.connected = false;
    this.closing = false;
    this.scramState = null;

    const startupPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    this.writeStartupMessage(socket);

    try {
      await startupPromise;
    } catch (error) {
      await this.tearDownSocket();
      throw error;
    }
  }

  private async openSocket(): Promise<any> {
    const socketOptions = this.options.path !== undefined
      ? { path: this.options.path }
      : { host: this.options.host, port: this.options.port };

    return await new Promise<any>((resolve, reject) => {
      const socket = net.createConnection(socketOptions);

      socket.once('connect', () => {
        socket.removeListener('error', reject);
        socket.setNoDelay(true);
        socket.on('data', (chunk: any) => this.onData(chunk));
        socket.on('error', (error: any) => this.onSocketError(error));
        socket.on('close', () => this.onSocketClose());
        resolve(socket);
      });

      socket.once('error', reject);
    });
  }

  private onSocketError(error: unknown): void {
    if (this.connectReject !== null && !this.connected) {
      this.connectReject(error);
      this.connectReject = null;
      this.connectResolve = null;
    }

    if (this.currentRequest !== null) {
      const request = this.currentRequest;
      this.currentRequest = null;
      request.reject(error);
    }

    this.connected = false;
    this.connectPromise = null;
  }

  private onSocketClose(): void {
    if (this.closing) {
      this.connected = false;
      this.connectPromise = null;
      return;
    }

    const error = new Error('PostgreSQL connection closed unexpectedly');

    if (this.connectReject !== null && !this.connected) {
      this.connectReject(error);
      this.connectReject = null;
      this.connectResolve = null;
    }

    if (this.currentRequest !== null) {
      const request = this.currentRequest;
      this.currentRequest = null;
      request.reject(error);
    }

    this.connected = false;
    this.connectPromise = null;
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 5) {
      const messageType = this.buffer.toString('ascii', 0, 1);
      const messageLength = this.buffer.readUInt32BE(1);
      const messageSize = messageLength + 1;

      if (this.buffer.length < messageSize) {
        return;
      }

      const payload = this.buffer.subarray(5, messageSize);
      this.buffer = this.buffer.subarray(messageSize);
      this.handleMessage(messageType, payload);
    }
  }

  private handleMessage(messageType: string, payload: Buffer): void {
    if (messageType === 'N') {
      return;
    }

    if (!this.connected) {
      this.handleStartupMessage(messageType, payload);
      return;
    }

    const request = this.currentRequest;
    if (request === null) {
      return;
    }

    switch (messageType) {
      case 'T':
        request.columns = parseRowDescription(payload);
        break;
      case 'D':
        request.rows.push(parseDataRow(payload, request.columns));
        break;
      case 'C':
        break;
      case 'E':
        request.error = parseErrorResponse(payload);
        break;
      case 'Z':
        this.currentRequest = null;

        if (request.error !== null) {
          request.reject(
            wrapQueryExecutionError(
              request.error,
              request.compiled.sql,
              request.compiled.params,
            ),
          );
          return;
        }

        request.resolve(request.rows);
        return;
      default:
        break;
    }
  }

  private handleStartupMessage(messageType: string, payload: Buffer): void {
    switch (messageType) {
      case 'R':
        this.handleAuthenticationRequest(payload);
        break;
      case 'S':
      case 'K':
        break;
      case 'E': {
        const error = parseErrorResponse(payload);
        this.failStartup(error);
        break;
      }
      case 'Z':
        this.connected = true;
        this.connectResolve?.();
        this.connectResolve = null;
        this.connectReject = null;
        this.connectPromise = Promise.resolve();
        break;
      default:
        break;
    }
  }

  private handleAuthenticationRequest(payload: Buffer): void {
    const authCode = payload.readInt32BE(0);

    switch (authCode) {
      case AUTH_OK:
        return;
      case AUTH_CLEARTEXT:
        this.sendPasswordMessage(ensurePassword(this.options.password));
        return;
      case AUTH_MD5: {
        const salt = payload.subarray(4, 8);
        const password = ensurePassword(this.options.password);
        const user = this.options.user;
        const inner = createHash('md5')
          .update(password + user, UTF8)
          .digest('hex');
        const outer = createHash('md5')
          .update(Buffer.concat([Buffer.from(inner, UTF8), salt]))
          .digest('hex');
        this.sendPasswordMessage(`md5${outer}`);
        return;
      }
      case AUTH_SASL: {
        const mechanisms = readCStringList(payload.subarray(4));
        if (!mechanisms.includes(SCRAM_MECHANISM)) {
          this.failStartup(
            new Error(`PostgreSQL server does not support ${SCRAM_MECHANISM} authentication`),
          );
          return;
        }

        const password = ensurePassword(this.options.password);
        const clientNonce = randomBytes(18).toString('base64');
        const clientFirstBare = `n=${scramEscapeUsername(this.options.user)},r=${clientNonce}`;
        const clientInitial = `n,,${clientFirstBare}`;
        this.scramState = {
          user: this.options.user,
          password,
          clientNonce,
          clientFirstBare,
        };

        this.sendSaslInitialResponse(SCRAM_MECHANISM, clientInitial);
        return;
      }
      case AUTH_SASL_CONTINUE:
        this.handleSaslContinue(payload.subarray(4));
        return;
      case AUTH_SASL_FINAL:
        this.handleSaslFinal(payload.subarray(4));
        return;
      default:
        this.failStartup(new Error(`unsupported PostgreSQL authentication method: ${authCode}`));
    }
  }

  private handleSaslContinue(payload: Buffer): void {
    const state = this.scramState;
    if (state === null) {
      this.failStartup(new Error('received SCRAM continuation without SCRAM handshake state'));
      return;
    }

    const serverFirstMessage = payload.toString(UTF8);
    const parsed = parseScramServerFirstMessage(serverFirstMessage);

    if (!parsed.nonce.startsWith(state.clientNonce)) {
      this.failStartup(new Error('SCRAM server nonce does not extend the client nonce'));
      return;
    }

    const saltedPassword = pbkdf2Sync(
      state.password,
      parsed.salt,
      parsed.iterations,
      32,
      'sha256',
    );
    const clientKey = createHmac('sha256', saltedPassword).update('Client Key', UTF8).digest();
    const storedKey = createHash('sha256').update(clientKey).digest();
    const clientFinalWithoutProof = `c=biws,r=${parsed.nonce}`;
    const authMessage = [
      state.clientFirstBare,
      serverFirstMessage,
      clientFinalWithoutProof,
    ].join(',');
    const clientSignature = createHmac('sha256', storedKey).update(authMessage, UTF8).digest();
    const clientProof = xorBuffers(clientKey, clientSignature).toString('base64');
    state.serverFirstMessage = serverFirstMessage;
    state.expectedServerSignature = createHmac('sha256', saltedPassword)
      .update('Server Key', UTF8)
      .digest('base64');

    this.scramState = state;
    this.sendSaslResponse(`${clientFinalWithoutProof},p=${clientProof}`);
  }

  private handleSaslFinal(payload: Buffer): void {
    const state = this.scramState;
    if (state === null) {
      this.failStartup(new Error('received SCRAM final message without handshake state'));
      return;
    }

    const serverFinalMessage = payload.toString(UTF8);
    const verified = parseScramServerFinalMessage(serverFinalMessage);

    if (verified.error !== undefined) {
      this.failStartup(new Error(verified.error));
      return;
    }

    if (verified.serverSignature !== undefined && state.expectedServerSignature !== undefined) {
      const received = Buffer.from(verified.serverSignature, 'base64');
      const expected = Buffer.from(state.expectedServerSignature, 'base64');

      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      ) {
        this.failStartup(new Error('SCRAM server signature validation failed'));
        return;
      }
    }
  }

  private sendPasswordMessage(password: string): void {
    this.writeMessage('p', Buffer.from(`${password}\0`, UTF8));
  }

  private sendSaslInitialResponse(mechanism: string, response: string): void {
    const mechanismBytes = Buffer.from(`${mechanism}\0`, UTF8);
    const responseBytes = Buffer.from(response, UTF8);
    const payload = Buffer.alloc(mechanismBytes.length + 4 + responseBytes.length);

    mechanismBytes.copy(payload, 0);
    payload.writeInt32BE(responseBytes.length, mechanismBytes.length);
    responseBytes.copy(payload, mechanismBytes.length + 4);
    this.writeMessage('p', payload);
  }

  private sendSaslResponse(response: string): void {
    this.writeMessage('p', Buffer.from(response, UTF8));
  }

  private writeStartupMessage(socket: any): void {
    const parts = [
      Buffer.alloc(4),
      Buffer.alloc(4),
      encodeCStringPair('user', this.options.user),
      encodeCStringPair('database', this.options.database),
      encodeCStringPair('client_encoding', 'UTF8'),
      encodeCStringPair('application_name', this.options.applicationName),
      Buffer.from([0]),
    ];

    const payloadLength = parts.reduce((total, part) => total + part.length, 0);
    const message = Buffer.alloc(payloadLength);
    let offset = 0;

    message.writeInt32BE(payloadLength, offset);
    offset += 4;
    message.writeInt32BE(196608, offset);
    offset += 4;

    for (const part of parts.slice(2)) {
      part.copy(message, offset);
      offset += part.length;
    }

    socket.write(message);
  }

  private writeSimpleQuery(sql: string): void {
    this.writeMessage('Q', Buffer.from(`${sql}\0`, UTF8));
  }

  private writeMessage(type: string, payload: Buffer): void {
    const socket = this.socket;
    if (socket === null) {
      throw new Error('PostgreSQL connection has not been established');
    }

    const message = Buffer.alloc(payload.length + 5);
    message.write(type, 0, 1, 'ascii');
    message.writeInt32BE(payload.length + 4, 1);
    payload.copy(message, 5);
    socket.write(message);
  }

  private failStartup(error: unknown): void {
    const reject = this.connectReject;
    this.connectReject = null;
    this.connectResolve = null;
    this.connectPromise = null;

    reject?.(error);
  }

  private async tearDownSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.connectPromise = null;
    this.currentRequest = null;
    this.scramState = null;
    this.connectResolve = null;
    this.connectReject = null;

    if (socket === null) {
      return;
    }

    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.destroy();
    });
  }
}

function resolveConnectionOptions(
  options: PostgresConnectionOptions,
): ResolvedConnectionOptions {
  const fromUrl = options.connectionString !== undefined
    ? parseConnectionString(options.connectionString)
    : {};

  const host = options.host ?? fromUrl.host ?? process.env.PGHOST ?? '127.0.0.1';
  const path = host.startsWith('/') ? host : fromUrl.path;
  const port = options.port ?? fromUrl.port ?? parseOptionalInteger(process.env.PGPORT) ?? 5432;
  const user = options.user ?? fromUrl.user ?? process.env.PGUSER ?? process.env.USER ?? 'postgres';
  const database = options.database
    ?? fromUrl.database
    ?? process.env.PGDATABASE
    ?? user;

  return {
    host: path === undefined ? host : undefined,
    path,
    port,
    database,
    user,
    password: options.password ?? fromUrl.password ?? process.env.PGPASSWORD,
    applicationName: options.applicationName ?? DEFAULT_APPLICATION_NAME,
  };
}

function parseConnectionString(connectionString: string): Partial<ResolvedConnectionOptions> {
  const url = new URL(connectionString);

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new TypeError('PostgreSQL connection string must use the postgres: or postgresql: scheme');
  }

  const path = url.hostname.length === 0 && url.pathname.length > 1
    ? decodeURIComponent(url.pathname)
    : undefined;
  const database = url.pathname.length > 1 ? decodeURIComponent(url.pathname.slice(1)) : undefined;

  return {
    host: path !== undefined ? path : url.hostname || undefined,
    path,
    port: url.port.length > 0 ? Number(url.port) : undefined,
    database: database === '' ? undefined : database,
    user: url.username.length > 0 ? decodeURIComponent(url.username) : undefined,
    password: url.password.length > 0 ? decodeURIComponent(url.password) : undefined,
  };
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function encodeCStringPair(key: string, value: string): Buffer {
  return Buffer.from(`${key}\0${value}\0`, UTF8);
}

function readCStringList(buffer: Buffer): string[] {
  const values: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const end = buffer.indexOf(0, offset);
    if (end < 0) {
      break;
    }

    const value = buffer.toString(UTF8, offset, end);
    offset = end + 1;

    if (value === '') {
      break;
    }

    values.push(value);
  }

  return values;
}

function parseRowDescription(buffer: Buffer): FieldDescription[] {
  let offset = 0;
  const fieldCount = buffer.readInt16BE(offset);
  offset += 2;

  const fields: FieldDescription[] = [];

  for (let index = 0; index < fieldCount; index += 1) {
    const nameEnd = buffer.indexOf(0, offset);
    if (nameEnd < 0) {
      throw new Error('invalid RowDescription message');
    }

    const name = buffer.toString(UTF8, offset, nameEnd);
    offset = nameEnd + 1;
    offset += 4; // table OID
    offset += 2; // attribute number
    const typeOid = buffer.readUInt32BE(offset);
    offset += 4;
    offset += 2; // type size
    offset += 4; // type modifier
    offset += 2; // format code

    fields.push({ name, typeOid });
  }

  return fields;
}

function parseDataRow(
  buffer: Buffer,
  columns: FieldDescription[] | null,
): Record<string, unknown> {
  if (columns === null) {
    throw new Error('received DataRow before RowDescription');
  }

  let offset = 0;
  const fieldCount = buffer.readInt16BE(offset);
  offset += 2;

  const row: Record<string, unknown> = {};

  for (let index = 0; index < fieldCount; index += 1) {
    const length = buffer.readInt32BE(offset);
    offset += 4;

    const column = columns[index];
    if (column === undefined) {
      throw new Error('data row column count does not match row description');
    }

    if (length === -1) {
      row[column.name] = null;
      continue;
    }

    const value = buffer.toString(UTF8, offset, offset + length);
    offset += length;
    row[column.name] = parseValue(column.typeOid, value);
  }

  return row;
}

function parseValue(typeOid: number, value: string): unknown {
  switch (typeOid) {
    case 16:
      return value === 't';
    case 20:
      return parseInt64(value);
    case 21:
    case 23:
    case 26:
      return Number(value);
    case 700:
    case 701:
    case 1700:
      return Number(value);
    case 114:
    case 3802:
      return JSON.parse(value);
    case 17:
      return Buffer.from(value.slice(2), 'hex');
    default:
      return value;
  }
}

function parseInt64(value: string): number | bigint {
  const parsed = BigInt(value);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);

  if (parsed >= minSafe && parsed <= maxSafe) {
    return Number(parsed);
  }

  return parsed;
}

function parseErrorResponse(buffer: Buffer): PostgresServerError {
  const fields = new Map<string, string>();
  let offset = 0;

  while (offset < buffer.length) {
    const fieldType = String.fromCharCode(buffer[offset] ?? 0);
    offset += 1;

    if (fieldType === '\0') {
      break;
    }

    const fieldEnd = buffer.indexOf(0, offset);
    if (fieldEnd < 0) {
      break;
    }

    fields.set(fieldType, buffer.toString(UTF8, offset, fieldEnd));
    offset = fieldEnd + 1;
  }

  return {
    severity: fields.get('S'),
    code: fields.get('C'),
    message: fields.get('M') ?? 'PostgreSQL error',
    detail: fields.get('D'),
    hint: fields.get('H'),
    position: parseOptionalInteger(fields.get('P')),
  };
}

function parseScramServerFirstMessage(message: string): {
  readonly nonce: string;
  readonly salt: Buffer;
  readonly iterations: number;
} {
  const parts = parseCommaSeparatedMessage(message);
  const nonce = parts.r;
  const salt = Buffer.from(parts.s, 'base64');
  const iterations = Number(parts.i);

  if (nonce === undefined || parts.s === undefined || !Number.isInteger(iterations)) {
    throw new Error('invalid SCRAM server first message');
  }

  return {
    nonce,
    salt,
    iterations,
  };
}

function parseScramServerFinalMessage(message: string): {
  readonly serverSignature?: string;
  readonly error?: string;
} {
  const parts = parseCommaSeparatedMessage(message);
  return {
    serverSignature: parts.v,
    error: parts.e,
  };
}

function parseCommaSeparatedMessage(message: string): Record<string, string> {
  const parts: Record<string, string> = {};

  for (const part of message.split(',')) {
    const equalsIndex = part.indexOf('=');
    if (equalsIndex < 0) {
      continue;
    }

    const key = part.slice(0, equalsIndex);
    const value = part.slice(equalsIndex + 1);
    parts[key] = value;
  }

  return parts;
}

function scramEscapeUsername(user: string): string {
  return user.replaceAll('=', '=3D').replaceAll(',', '=2C');
}

function xorBuffers(left: Buffer, right: Buffer): Buffer {
  const length = Math.min(left.length, right.length);
  const result = Buffer.alloc(length);

  for (let index = 0; index < length; index += 1) {
    result[index] = left[index]! ^ right[index]!;
  }

  return result;
}

function ensurePassword(password: string | undefined): string {
  if (password === undefined) {
    throw new TypeError('PostgreSQL password is required for this authentication method');
  }

  return password;
}

function substituteParams(sql: string, params: readonly unknown[]): string {
  return sql.replace(/\$(\d+)/g, (_match, placeholder) => {
    const index = Number(placeholder) - 1;
    const value = params[index];

    if (index < 0 || index >= params.length) {
      throw new RangeError(`missing value for PostgreSQL parameter $${placeholder}`);
    }

    return serializePostgresValue(value);
  });
}

function serializePostgresValue(value: unknown): string {
  if (value === null) {
    return 'NULL';
  }

  if (value === undefined) {
    throw new TypeError('cannot serialise undefined as a PostgreSQL parameter');
  }

  if (typeof value === 'string') {
    return quoteStringLiteral(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError('cannot serialise non-finite numbers as PostgreSQL parameters');
    }

    return String(value);
  }

  if (typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RangeError('cannot serialise invalid Date values as PostgreSQL parameters');
    }

    return `${quoteStringLiteral(value.toISOString())}::timestamptz`;
  }

  if (Buffer.isBuffer(value)) {
    return `E'\\\\x${(value as any).toString('hex')}'::bytea`;
  }

  if (value instanceof Uint8Array) {
    return `E'\\\\x${Buffer.from(value).toString('hex')}'::bytea`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new TypeError('cannot serialise empty arrays as PostgreSQL parameters');
    }

    return `ARRAY[${value.map((entry) => serializePostgresValue(entry)).join(', ')}]`;
  }

  throw new TypeError(`unsupported PostgreSQL parameter type: ${typeof value}`);
}

function quoteStringLiteral(text: string): string {
  if (text.includes('\0')) {
    throw new TypeError('PostgreSQL string literals cannot contain NUL bytes');
  }

  return `E'${text.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
}
