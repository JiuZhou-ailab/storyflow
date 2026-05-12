export type WritingProjectType = "novel" | "screenplay" | "short-form";

export interface WritingProjectManifest {
  schemaVersion: 1;
  type: WritingProjectType;
  title?: string;
  language?: string;
  profile?: string;
  methodPack?: {
    id: string;
    version: number;
  };
  storageProfile?: string;
}

export interface WritingProjectDirectories {
  bible?: string;
  story?: string;
  state?: string;
  timeline?: string;
  analysis?: string;
  work?: string;
  brief?: string;
  notes?: string;
  style?: string;
  drafts?: string;
  revisions?: string;
  published?: string;
  reviews?: string;
}

export interface DetectedWritingProject {
  type: WritingProjectType;
  source: "manifest" | "structure";
  rootPath: string;
  manifest: WritingProjectManifest;
  directories: WritingProjectDirectories;
}
