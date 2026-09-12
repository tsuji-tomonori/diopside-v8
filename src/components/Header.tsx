import { NavLink } from 'react-router-dom';

export function Header(): React.JSX.Element {
  return (
    <header className="site-header">
      <NavLink className="brand" to="/" aria-label="diopside ホーム">
        <span className="brand-mark" aria-hidden="true">◇</span>
        <span>diopside</span>
      </NavLink>
      <nav aria-label="主要メニュー">
        <NavLink to="/" end>動画を探す</NavLink>
        <NavLink to="/games">ゲームを探す</NavLink>
        <NavLink to="/songs">歌を探す</NavLink>
        <NavLink to="/entities">人物・作品・企画</NavLink>
        <NavLink to="/library">端末内リスト</NavLink>
      </nav>
    </header>
  );
}
