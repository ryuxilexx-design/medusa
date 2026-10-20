import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "meduza";
export default defineRailway(() => {
  const meduza = service("meduza", {
    build: { buildCommand: "npm run build", buildEnvironment: "V3", builder: "RAILPACK" },
    start: "npm run start",
    healthcheck: "/login",
    healthcheckTimeout: 300,
    replicas: { "iad": 1 },
  });

  return project("feisty-amazement", {
    variables: { managed: false },
    resources: [meduza],
  });
});
