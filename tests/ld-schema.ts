/**
 * A local, offline schema check for the site's JSON-LD (no network validator). It knows only the schema.org types the
 * site prints, and for each one the properties it may carry and the ones it must carry. It fails on:
 * an unknown type or property, a missing required property, an empty / null / undefined value, a URL that is not an
 * absolute https URL on the site (or one of the school's own social pages), a date that is not YYYY-MM-DD, and a
 * `@context` anywhere but the top. Required sets follow schema.org plus Google's Course list guide (name, description,
 * provider) so a page that passes is one Google can read.
 */

type Kind = 'text' | 'url' | 'date' | 'node' | 'nodes' | 'int';
type TypeSpec = { required: string[]; props: Record<string, Kind> };

const PLACE_ADDRESS: Record<string, Kind> = { name: 'text', address: 'node' };

export const LD_TYPES: Record<string, TypeSpec> = {
  EducationalOrganization: {
    required: ['name', 'url'],
    props: { '@id': 'url', name: 'text', url: 'url', logo: 'url', image: 'url', description: 'text', inLanguage: 'text', address: 'node', sameAs: 'url' },
  },
  PostalAddress: { required: ['addressCountry'], props: { addressLocality: 'text', addressCountry: 'text' } },
  Course: {
    required: ['name', 'description', 'provider'],
    props: { '@id': 'url', name: 'text', description: 'text', url: 'url', image: 'url', inLanguage: 'text', teaches: 'text', provider: 'node', hasCourseInstance: 'nodes' },
  },
  CourseInstance: { required: ['instructor'], props: { instructor: 'nodes', location: 'node', startDate: 'date' } },
  Person: { required: ['name'], props: { name: 'text' } },
  Place: { required: ['name'], props: PLACE_ADDRESS },
  ItemList: { required: ['itemListElement'], props: { name: 'text', itemListElement: 'nodes' } },
  ListItem: { required: ['position', 'item'], props: { position: 'int', item: 'node' } },
};

const SOCIAL = /^https:\/\/(www\.)?(facebook|instagram|youtube)\.com\//;

export function checkLd(data: unknown): string[] {
  const errors: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

  function node(v: unknown, at: string, top: boolean) {
    if (!isObj(v)) return void errors.push(`${at}: expected an object`);
    if (top && v['@context'] !== 'https://schema.org') errors.push(`${at}: @context must be https://schema.org`);
    if (!top && '@context' in v) errors.push(`${at}: @context only at the top`);
    const type = v['@type'];
    const spec = typeof type === 'string' ? LD_TYPES[type] : undefined;
    if (!spec) return void errors.push(`${at}: unknown @type ${String(type)}`);
    for (const r of spec.required) if (!(r in v)) errors.push(`${at} (${type}): missing ${r}`);
    for (const [key, value] of Object.entries(v)) {
      if (key === '@context' || key === '@type') continue;
      const kind = spec.props[key];
      if (!kind) {
        errors.push(`${at} (${type}): property ${key} is not allowed here`);
        continue;
      }
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0) errors.push(`${at}.${key}: empty list`);
      if (Array.isArray(value) && kind !== 'nodes' && key !== 'sameAs') errors.push(`${at}.${key}: a list is not expected`);
      values.forEach((one, i) => leaf(one, kind, Array.isArray(value) ? `${at}.${key}[${i}]` : `${at}.${key}`));
    }
  }

  function leaf(v: unknown, kind: Kind, at: string) {
    if (v === null || v === undefined || v === '') return void errors.push(`${at}: empty value`);
    if (kind === 'node' || kind === 'nodes') return node(v, at, false);
    if (kind === 'int') return void (Number.isInteger(v) && (v as number) > 0 ? null : errors.push(`${at}: expected a positive integer`));
    if (typeof v !== 'string') return void errors.push(`${at}: expected text`);
    if (/\b(undefined|null|NaN)\b|غير مذكور/.test(v)) errors.push(`${at}: placeholder text «${v}»`);
    if (v !== v.trim()) errors.push(`${at}: stray spaces`);
    if (kind === 'url') {
      let u: URL | null = null;
      try {
        u = new URL(v);
      } catch {
        errors.push(`${at}: not a URL «${v}»`);
      }
      if (u && !(u.protocol === 'https:' && (u.host === 'noor-alawsiya.com' || SOCIAL.test(v)))) errors.push(`${at}: not an absolute site URL «${v}»`);
    }
    if (kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) errors.push(`${at}: not YYYY-MM-DD «${v}»`);
  }

  node(data, '$', true);
  return errors;
}
