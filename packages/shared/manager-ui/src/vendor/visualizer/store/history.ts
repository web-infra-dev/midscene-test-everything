import {
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useMemo,
} from 'react';
import { useStore } from 'zustand';
import * as Z from 'zustand';

const { create } = Z;

// Use a new key to avoid conflicts with the old data structure.
const HISTORY_KEY = 'midscene-prompt-history-v2';
const LAST_SELECTED_TYPE_KEY = 'midscene-last-selected-type';

export interface HistoryItem {
  type: string;
  prompt: string;
  params?: Record<string, any>;
  timestamp: number;
}

export type HistoryState = Record<string, HistoryItem[]>;

/** Local extension: optional namespace; omitted preserves upstream shared history. */
export function createHistoryStore(namespace?: string) {
  const historyKey =
    namespace === undefined
      ? HISTORY_KEY
      : `${HISTORY_KEY}:${encodeURIComponent(namespace)}`;
  const typeKey =
    namespace === undefined
      ? LAST_SELECTED_TYPE_KEY
      : `${LAST_SELECTED_TYPE_KEY}:${encodeURIComponent(namespace)}`;
  // Function to get history from localStorage
  const getHistoryFromLocalStorage = (): HistoryState => {
    const historyString = localStorage.getItem(historyKey);
    return historyString ? JSON.parse(historyString) : {};
  };

  // Function to get last selected type from localStorage
  const getLastSelectedType = (): string => {
    return localStorage.getItem(typeKey) || 'aiAct';
  };

  // Function to save last selected type to localStorage
  const setLastSelectedType = (type: string): void => {
    localStorage.setItem(typeKey, type);
  };

  // Create the history store
  return create<{
    history: HistoryState;
    lastSelectedType: string;
    clearHistory: (type: string) => void;
    addHistory: (historyItem: HistoryItem) => void;
    getHistoryForType: (type: string) => HistoryItem[];
    setLastSelectedType: (type: string) => void;
  }>((set, get) => ({
    history: getHistoryFromLocalStorage(),
    lastSelectedType: getLastSelectedType(),

    clearHistory: (type: string) => {
      const newHistory = { ...get().history };
      delete newHistory[type];
      set({ history: newHistory });
      localStorage.setItem(historyKey, JSON.stringify(newHistory));
    },

    addHistory: (historyItem) => {
      const { type } = historyItem;
      const currentHistory = get().history;
      const typeHistory = currentHistory[type] || [];

      // Prevent duplicates by comparing a combination of prompt and params.
      const stringifiedNewItem = JSON.stringify({
        prompt: historyItem.prompt,
        params: historyItem.params,
      });

      const newTypeHistory = [
        historyItem,
        ...typeHistory.filter((h) => {
          const stringifiedOldItem = JSON.stringify({
            prompt: h.prompt,
            params: h.params,
          });
          return stringifiedOldItem !== stringifiedNewItem;
        }),
      ];

      // Limit history to 10 items per type
      if (newTypeHistory.length > 10) {
        newTypeHistory.length = 10;
      }

      const newHistory = {
        ...currentHistory,
        [type]: newTypeHistory,
      };

      set({ history: newHistory });
      localStorage.setItem(historyKey, JSON.stringify(newHistory));
    },

    getHistoryForType: (type: string) => {
      return get().history[type] || [];
    },

    setLastSelectedType: (type: string) => {
      set({ lastSelectedType: type });
      setLastSelectedType(type);
    },
  }));
}
type HistoryStore = ReturnType<typeof createHistoryStore>;
const stores = new Map<string | undefined, HistoryStore>();
export function getHistoryStore(namespace?: string): HistoryStore {
  let store = stores.get(namespace);
  if (!store) {
    store = createHistoryStore(namespace);
    stores.set(namespace, store);
  }
  return store;
}
const HistoryContext = createContext<HistoryStore | null>(null);
export function PromptHistoryProvider({
  namespace,
  children,
}: { namespace?: string; children: ReactNode }) {
  const store = useMemo(() => getHistoryStore(namespace), [namespace]);
  return createElement(HistoryContext.Provider, { value: store }, children);
}
export function useHistoryStore<T>(
  selector: (state: ReturnType<HistoryStore['getState']>) => T,
): T {
  const store = useContext(HistoryContext);
  return useStore(store ?? getHistoryStore(), selector);
}
