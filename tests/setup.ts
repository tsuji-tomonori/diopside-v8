import '@testing-library/jest-dom/vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, writable: true, value: IDBKeyRange });
