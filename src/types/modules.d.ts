declare module "pdf-parse" {
  const parse: (input: Buffer) => Promise<{ text: string; info?: unknown }>;
  export default parse;
}

declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    close(): void;
    prepare(sql: string): {
      run(...args: unknown[]): { changes: number; lastInsertRowid: unknown };
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
  }
}
