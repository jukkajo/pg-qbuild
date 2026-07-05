declare module 'node:net' {
  const net: any;
  export default net;
}

declare module 'node:crypto' {
  export const createHash: any;
  export const createHmac: any;
  export const pbkdf2Sync: any;
  export const randomBytes: any;
  export const timingSafeEqual: any;
}

type Buffer = any;

declare const Buffer: any;
declare const process: any;
declare const console: any;
declare const URL: any;
declare const TextDecoder: any;
