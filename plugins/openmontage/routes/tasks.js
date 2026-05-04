export default function (app, ctx) {
  const store = () => ctx._openMontage?.store;

  app.get("/tasks/batch/:batchId", (c) => {
    const s = store();
    if (!s) return c.json({ error: "not initialized" }, 503);
    return c.json({ tasks: s.getByBatch(c.req.param("batchId")) });
  });
}
