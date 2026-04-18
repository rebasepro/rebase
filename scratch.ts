import { RebaseWebSocketClient } from "./packages/client/src/websocket";

const ws = new RebaseWebSocketClient({
  websocketUrl: "ws://localhost:4000/ws"
});

// We can't really authenticate easily without token, but maybe wait, we can just look at the code!
