export type SchemaDefinition = object;

export type TableName<Schema extends SchemaDefinition> = Extract<keyof Schema, string>;

export type ColumnName<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = Extract<keyof TableRow<Schema, Table>, string>;

export type TableRow<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = Schema extends { readonly [Key in Table]: infer Row }
  ? Row
  : Schema extends { [Key in Table]: infer Row }
    ? Row
    : never;

export type NonEmptyTuple<T> = readonly [T, ...T[]];

export type SelectRow<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
  Columns extends readonly ColumnName<Schema, Table>[],
> = Pick<TableRow<Schema, Table>, Columns[number]>;

export type InsertRowInput<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = Partial<TableRow<Schema, Table>>;

export type UpdateRowInput<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = Partial<TableRow<Schema, Table>>;

export type QueryKind = 'select' | 'insert' | 'update' | 'delete';

export interface QueryExecutionEvent {
  readonly kind: QueryKind;
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface QueryExecutionSuccessEvent extends QueryExecutionEvent {
  readonly durationMs: number;
}

export interface QueryExecutionFailureEvent extends QueryExecutionEvent {
  readonly durationMs: number;
  readonly error: unknown;
}

export interface QueryExecutionHooks {
  readonly beforeExecute?: (event: QueryExecutionEvent) => void | Promise<void>;
  readonly afterSuccess?: (event: QueryExecutionSuccessEvent) => void | Promise<void>;
  readonly afterFailure?: (event: QueryExecutionFailureEvent) => void | Promise<void>;
}
