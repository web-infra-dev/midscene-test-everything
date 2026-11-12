import { createContext, useContext } from 'react';

export type PlaygroundTranslate = (
  message: string,
  values?: readonly unknown[],
) => string;
export const defaultPlaygroundTranslate: PlaygroundTranslate = (
  message,
  values = [],
) =>
  message.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
export const PlaygroundTranslationContext = createContext<PlaygroundTranslate>(
  defaultPlaygroundTranslate,
);
export const usePlaygroundTranslation = () =>
  useContext(PlaygroundTranslationContext);
