import * as sandbox from "./procedures/sandbox";
import * as chat from "./procedures/chat";
import * as deploy from "./procedures/deploy";

export const router = {
  sandbox: {
    readFile: sandbox.readFile,
    listFiles: sandbox.listFiles,
    getOrCreate: sandbox.getOrCreateSandbox,
  },
  chat: {
    send: chat.sendMessage,
  },
  deploy: {
    files: deploy.deployFiles,
    status: deploy.getDeploymentStatus,
    logs: deploy.streamDeploymentLogs,
  },
};

export type AppRouter = typeof router;
