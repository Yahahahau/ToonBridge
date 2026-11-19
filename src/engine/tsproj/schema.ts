// Exact CREATE TABLE statements copied from app-made ToonSquid projects (sqlite_master).
export const DATA_SCHEMA: Record<string, string> = {
  meta_i: 'CREATE TABLE "meta_i" ("key" TEXT PRIMARY KEY NOT NULL, "value" INTEGER NOT NULL)',
  meta_d: 'CREATE TABLE "meta_d" ("key" TEXT PRIMARY KEY NOT NULL, "value" BLOB NOT NULL)',
  scenes: 'CREATE TABLE "scenes" ("id" TEXT PRIMARY KEY NOT NULL, "index" INTEGER NOT NULL)',
  res_anim_clips: 'CREATE TABLE "res_anim_clips" ("id" TEXT PRIMARY KEY NOT NULL)',
  res_video_clips: 'CREATE TABLE "res_video_clips" ("id" TEXT PRIMARY KEY NOT NULL)',
  res_audio_clips: 'CREATE TABLE "res_audio_clips" ("id" TEXT PRIMARY KEY NOT NULL, "fileType" INTEGER NOT NULL)',
  res_shared_textures: 'CREATE TABLE "res_shared_textures" ("ownerId" TEXT NOT NULL, "ownerType" INTEGER NOT NULL, "textureId" TEXT NOT NULL, "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "x" INTEGER NOT NULL, "y" INTEGER NOT NULL, "w" INTEGER NOT NULL, "h" INTEGER NOT NULL, PRIMARY KEY ("ownerId", "ownerType"))',
  res_shared_owners: 'CREATE TABLE "res_shared_owners" ("ownerId" TEXT NOT NULL, "ownerType" INTEGER NOT NULL, "textureId" TEXT NOT NULL, "index" INTEGER NOT NULL, PRIMARY KEY ("ownerId", "ownerType"))',
  folders: 'CREATE TABLE "folders" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "lMD" DATETIME NOT NULL, "children" BLOB NOT NULL, "otherData" BLOB)',
};
export const ANIM_SCHEMA: Record<string, string> = {
  meta_i: DATA_SCHEMA.meta_i,
  drawings: 'CREATE TABLE "drawings" ("id" TEXT PRIMARY KEY NOT NULL, "data" BLOB NOT NULL)',
  layers: 'CREATE TABLE "layers" ("id" TEXT PRIMARY KEY NOT NULL, "type" INTEGER NOT NULL, "data" BLOB NOT NULL)',
  animationClip: 'CREATE TABLE "animationClip" ("id" TEXT PRIMARY KEY NOT NULL, "data" BLOB NOT NULL)',
};

/** Layer type ids observed in app-made files. */
export const LT = { VECTOR: 1, CLIP: 4, TIMELINE: 10, BACKGROUND: 11, EFFECT: 121 } as const;
