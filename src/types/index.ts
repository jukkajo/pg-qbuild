export type SchemaDefinition = object;

export type TableName<Schema extends SchemaDefinition> = Extract<keyof Schema, string>;

export type ColumnName<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = Schema[Table] extends object ? Extract<keyof Schema[Table], string> : never;

export type TableRow<
  Schema extends SchemaDefinition,
  Table extends TableName<Schema>,
> = Schema[Table];
