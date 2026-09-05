import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Header } from './Header.tsx';

describe('共通ヘッダー', () => {
  it('モバイルメニューを必要なときだけ開き、Escapeで閉じて操作位置へ戻す', () => {
    renderHeader();

    const toggle = screen.getByRole('button', { name: 'メニューを開く' });
    const navigation = screen.getByRole('navigation', { name: '主要メニュー' });
    expect(toggle).toHaveAttribute('aria-controls', 'primary-navigation');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(navigation).toHaveAttribute('data-open', 'false');

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'メニューを閉じる' })).toHaveAttribute('aria-expanded', 'true');
    expect(navigation).toHaveAttribute('data-open', 'true');

    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('button', { name: 'メニューを開く' })).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'メニューを開く' })).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('移動先を選ぶとメニューを閉じる', () => {
    renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'メニューを開く' }));
    fireEvent.click(screen.getByRole('link', { name: 'ゲームを探す' }));

    expect(screen.getByRole('button', { name: 'メニューを開く' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('navigation', { name: '主要メニュー' })).toHaveAttribute('data-open', 'false');
  });
});

function renderHeader(): void {
  render(<MemoryRouter><Header /></MemoryRouter>);
}
