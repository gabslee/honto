// Neon-like `sql` over PGlite for the route tests: lazy tagged queries (awaited alone, or batched by
// `sql.transaction([...])` like @neondatabase/serverless) and a real transaction (all or nothing).
export function pgliteSql(db) {
  const sql = (parts, ...values) => {
    const text = parts.reduce((out, part, i) => out + (i ? `$${i}` : '') + part, '');
    let promise = null;
    const run = () => (promise ??= db.query(text, values).then((result) => result.rows));
    return { text, values, then: (ok, fail) => run().then(ok, fail), catch: (fail) => run().catch(fail), finally: (done) => run().finally(done) };
  };
  sql.transaction = (queries) => db.transaction(async (tx) => {
    const results = [];
    for (const query of queries) results.push((await tx.query(query.text, query.values)).rows);
    return results;
  });
  return sql;
}
