#!/usr/bin/env node
'use strict';

// Explicit, read-only deployment probe. Credentials are read only from server env.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { Wizard404Client, ApiError, normalizeType, unwrapList, unwrapDetail, entityName } = require('../lib/api.cjs');

function argumentsOf(argv) {
  const known = new Set(['type', 'id', 'query', 'search-param', 'page-param', 'page-size-param', 'base-url', 'out', 'auth-mode']);
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') return { help: true };
    const key = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !known.has(key) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) throw new Error(`未知或缺值的参数：${key}`);
    result[key] = argv[++i];
  }
  return result;
}

function scrub(value, secret) {
  if (typeof value === 'string') return (secret ? value.split(secret).join('[REDACTED]') : value).replace(/w404_dev_[A-Za-z0-9_-]+/g, '[REDACTED]');
  if (Array.isArray(value)) return value.map(v => scrub(v, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /authorization|api[_-]?key|access[_-]?token|cookie|password|secret/i.test(key) ? '[REDACTED]' : scrub(child, secret)]));
  return value;
}

async function main(argv) {
  const args = argumentsOf(argv);
  if (args.help) {
    console.log([
      'Wizard404 只读联调工具（不接受命令行密钥）',
      '环境变量：W404_API_KEY 与 W404_USER_AGENT（包含真实邮箱或项目地址）',
      '按 ID：node tools/probe-api.cjs --type mob --id 1749326 --out ./probe.json',
      '名称参数基础验证：node tools/probe-api.cjs --type spell --query "Fire Cat" --search-param q --out ./probe.json',
      '名称验证会请求一次指定关键词和一次随机不存在的关键词；不会猜测多个参数或遍历网站。',
      '其余选项：--page-param page --page-size-param limit --auth-mode bearer --base-url https://wizard404.com/api/v1',
      '输出不包含请求头或密钥；成功也只证明此样例，分页和其它类别仍需分别核对。',
    ].join('\n'));
    return;
  }
  const type = normalizeType(args.type || 'spell');
  if (!!args.id === !!args.query) throw new Error('请提供 --id 或 --query 其中之一。');
  const key = process.env.W404_API_KEY || '';
  const config = {
    baseUrl: args['base-url'] || 'https://wizard404.com/api/v1',
    apiKey: key,
    userAgent: process.env.W404_USER_AGENT || '',
    authMode: args['auth-mode'] || 'bearer',
    onlineSearchEnabled: true,
    searchParam: args['search-param'] || 'q', pageParam: args['page-param'] || 'page',
    pageSizeParam: args['page-size-param'] ?? 'limit', pageSize: 5,
    minIntervalMs: 1500, timeoutMs: 15000,
  };
  const client = new Wizard404Client(config);
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(), type,
    provenance: 'Authenticated request from the machine running this probe; no credentials stored.',
    authenticatedResponseReceived: false, searchParameterBasicCheck: null,
  };
  try {
    if (args.id) {
      const response = await client.detail(type, args.id);
      const data = unwrapDetail(response.body, type);
      report.authenticatedResponseReceived = true;
      report.endpoint = response.url;
      report.name = entityName(data);
      report.response = response.body;
    } else {
      const positive = await client.search(type, args.query, 1);
      const list = unwrapList(positive.body, type);
      const probeWord = `zz_w404_probe_${randomBytes(12).toString('hex')}`;
      const negative = await client.search(type, probeWord, 1);
      const negativeList = unwrapList(negative.body, type);
      const wanted = args.query.normalize('NFKC').toLowerCase();
      const matched = list.items.filter(item => entityName(item).normalize('NFKC').toLowerCase().includes(wanted));
      report.authenticatedResponseReceived = true;
      report.endpoint = positive.url;
      report.query = args.query;
      report.searchParam = config.searchParam;
      report.positiveMatches = matched.length;
      report.negativeCount = negativeList.items.length;
      report.searchParameterBasicCheck = matched.length > 0 && negativeList.items.length === 0;
      report.paginationVerified = false;
      report.response = positive.body;
      report.negativeResponse = negative.body;
      report.note = report.searchParameterBasicCheck ? '此关键词与负对照通过基础检验；仍需核对分页和其它类别。' : '搜索参数或返回结构尚未验证，请勿开启线上按名搜索。';
    }
  } catch (error) {
    report.error = { code: error instanceof ApiError ? error.code : 'probe-error', status: error.status || null, message: error instanceof ApiError ? error.message : '联调失败，请检查参数与响应结构。', retryAfterMs: error.retryAfterMs || 0 };
    process.exitCode = 1;
  } finally { client.dispose(); }
  const safe = scrub(report, key);
  if (args.out) {
    const out = path.resolve(args.out);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(safe, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    console.log(`已写入脱敏联调报告：${out}`);
  }
  console.log(JSON.stringify({ authenticatedResponseReceived: safe.authenticatedResponseReceived, searchParameterBasicCheck: safe.searchParameterBasicCheck, name: safe.name, positiveMatches: safe.positiveMatches, negativeCount: safe.negativeCount, note: safe.note, error: safe.error }, null, 2));
}

if (require.main === module) main(process.argv.slice(2)).catch(() => { console.error('联调工具参数或写文件失败；请运行 --help 查看说明。'); process.exitCode = 1; });
module.exports = { main, argumentsOf, scrub };
