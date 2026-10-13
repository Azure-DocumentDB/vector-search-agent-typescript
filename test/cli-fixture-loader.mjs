// Test-only module hook: replaces only Mongo client transport construction.
// Real CLI/auth/config and token validation are loaded unchanged. Never used by production commands.
import { registerHooks } from 'node:module';
const authURL = new URL('../dist/auth.js', import.meta.url).href;
registerHooks({ load(url, context, nextLoad) {
  const out = nextLoad(url, context);
  if (url !== authURL) return out;
  return { ...out, source: out.source.toString().replace('export function makeMongo(', 'function unusedMongo(') + `
export function makeMongo(c) {
  return { connect: async () => {}, close: async () => {}, db: name => {
    if(name !== c.database) throw Error('wrong scope');
    return { command: async command => { if(JSON.stringify(command)!=='{"ping":1}') throw Error('not ping'); return {ok:1}; },
      collection: name => { if(name !== c.collection) throw Error('wrong collection'); return {}; } };
  } };
}
` };
} });
