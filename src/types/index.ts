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
