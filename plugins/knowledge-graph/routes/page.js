import { renderGraphHtml } from "../lib/render-graph-html.js";

export default function (app) {
  app.get("/page", (c) => {
    const hanaCss = c.req.query("hana-css") || "";
    const token = c.req.query("token") || c.req.query("api_key") || c.req.query("apikey") || "";
    return c.html(renderGraphHtml({ mode: "page", hanaCss, token }));
  });
}
