import type {
  InsertQuery,
  Query,
  SelectQuery,
  UpdateQuery,
} from '../../src/core/index.js';
import {
  assignment,
  column,
  insertQuery,
  selectQuery,
  updateQuery,
} from '../../src/core/index.js';

const selectModel: SelectQuery = selectQuery({
  sourceTable: 'users',
  selectedColumns: [column('id')],
});

const insertModel: InsertQuery = insertQuery({
  targetTable: 'users',
  rows: [[assignment('email', column('email'))]],
});

const updateModel: UpdateQuery = updateQuery({
  targetTable: 'users',
  assignments: [assignment('name', column('name'))],
});

const query: Query = Math.random() > 0.5 ? selectModel : insertModel;

void query;
void updateModel;

insertQuery({
  targetTable: 'users',
  // @ts-expect-error insert rows must be non-empty
  rows: [],
});

selectQuery({
  sourceTable: 'users',
  // @ts-expect-error selected columns must be non-empty
  selectedColumns: [],
});

updateQuery({
  targetTable: 'users',
  // @ts-expect-error update assignments must be non-empty
  assignments: [],
});
