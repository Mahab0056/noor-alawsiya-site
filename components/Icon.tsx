import { ICONS, type IconName } from '@/lib/icons';

type Size = 's' | 'm' | 'l';

/** Decorative line icon. Always paired with visible text, so it is hidden from assistive tech. */
export function Icon({ name, size = 'm' }: { name: IconName; size?: Size }) {
  const cls = size === 'm' ? 'i' : `i ${size}`;
  return <svg className={cls} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;
}
