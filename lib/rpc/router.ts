
import * as sandbox from "./procedures/sandbox";
import * as chat from "./procedures/chat";

export const router = {
  sandbox: {
    readFile: sandbox.readFile,
    listFiles: sandbox.listFiles,
    getOrCreate: sandbox.getOrCreateSandbox,
  },
  chat: {
    send: chat.sendMessage,
  },
};

export type AppRouter = typeof router;
