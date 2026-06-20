/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAMEDATA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
