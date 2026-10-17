// Canonical known entities wrapper shared with backend scripts
// eslint-disable-next-line
const ke = require("../../scripts/known-entities");

export type EntityCategory = "family" | "guest" | "service" | "suspicious";

export type KnownEntity = {
  id: string;
  type: "plate" | "person";
  identifier: string;
  normalizedIdentifier: string;
  name: string;
  category: EntityCategory;
  notes: string;
  notify: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeen: string | null;
  lastCamera: string | null;
};

export const loadKnownEntities: () => KnownEntity[] = ke.loadKnownEntities;
export const saveKnownEntities: (entities: KnownEntity[]) => boolean = ke.saveKnownEntities;
export const addKnownEntity: (data: {
  type?: "plate" | "person";
  identifier: string;
  name: string;
  category?: EntityCategory;
  notes?: string;
  notify?: boolean;
}) => KnownEntity = ke.addKnownEntity;
export const updateKnownEntity: (
  id: string,
  updates: Partial<Omit<KnownEntity, "id">>
) => KnownEntity | null = ke.updateKnownEntity;
export const deleteKnownEntity: (id: string) => boolean = ke.deleteKnownEntity;
export const findKnownEntity: (
  identifier: string,
  type?: "plate" | "person"
) => KnownEntity | null = ke.findKnownEntity;
export const touchKnownEntity: (id: string, cameraName?: string) => KnownEntity | null =
  ke.touchKnownEntity;
export const normalizeIdentifier: (val: string) => string = ke.normalizeIdentifier;
