import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';

export function Header(): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const closeFromOutside = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuButtonRef.current?.contains(target) || navRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [menuOpen]);

  const closeMenu = (): void => setMenuOpen(false);

  return (
    <header className="site-header">
      <NavLink className="brand" to="/" aria-label="diopside ホーム">
        <span className="brand-mark" aria-hidden="true">◇</span>
        <span>diopside</span>
      </NavLink>
      <button
        ref={menuButtonRef}
        className="nav-toggle"
        type="button"
        aria-controls="primary-navigation"
        aria-expanded={menuOpen}
        aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        <span>メニュー</span>
      </button>
      <nav ref={navRef} id="primary-navigation" aria-label="主要メニュー" data-open={menuOpen}>
        <NavLink to="/" end onClick={closeMenu}>動画を探す</NavLink>
        <NavLink to="/games" onClick={closeMenu}>ゲームを探す</NavLink>
        <NavLink to="/songs" onClick={closeMenu}>歌を探す</NavLink>
        <NavLink to="/entities" onClick={closeMenu}>人物・作品・企画</NavLink>
        <NavLink to="/library" onClick={closeMenu}>端末内リスト</NavLink>
      </nav>
    </header>
  );
}
