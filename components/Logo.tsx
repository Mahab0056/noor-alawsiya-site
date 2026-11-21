import Image from 'next/image';
import Link from 'next/link';

export function Logo({ mark = 'black', sub = 'للدراسات القرآنية' }: { mark?: 'black' | 'yellow'; sub?: string }) {
  return (
    <Link className="logo" href="/">
      <Image src={`/img/mark-${mark}.png`} alt="" width={37} height={48} />
      <span>
        نور الأوصياء<small>{sub}</small>
      </span>
    </Link>
  );
}
