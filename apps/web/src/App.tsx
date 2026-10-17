import { client, useClient } from './client';
import { Game } from './screens/Game';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';

export function App() {
  const { view, restoring, connected, notice } = useClient();

  let screen;
  if (view) screen = view.phase === 'lobby' ? <Lobby view={view} /> : <Game view={view} />;
  else if (restoring) screen = <div className="center muted">Rejoining…</div>;
  else screen = <Home notice={notice} />;

  return (
    <>
      {!connected && (
        <div className="banner">
          Reconnecting… {view && <button onClick={() => client.leave()}>Leave</button>}
        </div>
      )}
      {screen}
    </>
  );
}
