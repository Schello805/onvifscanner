const source = require("../../scripts/legacy-rtsp-source");

type SourceOptions = {
  camera: { id: string; username?: string | null; password?: string | null };
  uri: string;
  source?: string;
  alwaysOn?: boolean;
};

export const mediaSourceConfig: (options: SourceOptions) => {
  source: string;
  sourceOnDemand: boolean;
  runOnInit: string;
  runOnInitRestart: boolean;
  runOnDemand: string;
  runOnDemandRestart: boolean;
} = source.mediaSourceConfig;
