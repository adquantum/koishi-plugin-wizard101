import { Context, Schema } from 'koishi';

export interface Config {
  command?: string;
  defaultType?: 'item' | 'spell' | 'mob' | 'zone' | 'npc' | 'quest' | 'talent' | 'event';
  enableChineseAliases?: boolean;
  localePath?: string;
  aliases?: Record<string, string | string[]>;
  apiKey?: string;
  authMode?: 'bearer' | 'x-api-key';
  baseUrl?: string;
  userAgent?: string;
  onlineSearchEnabled?: boolean;
  searchParam?: string;
  pageParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  minIntervalMs?: number;
  cooldownMs?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  maxCacheBytes?: number;
  maxResponseBytes?: number;
  maxQueue?: number;
}

export const name: string;
export const usage: string;
export const Config: Schema<Config>;
export function apply(ctx: Context, config: Config): void;
