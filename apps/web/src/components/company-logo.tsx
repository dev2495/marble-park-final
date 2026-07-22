import { cn } from '@/lib/utils';

export function CompanyLogo({
  src = '/brand/marble-park-logo-square.png',
  name = 'Marble Park',
  className = '',
  imageClassName = '',
}: {
  src?: string;
  name?: string;
  className?: string;
  imageClassName?: string;
}) {
  return <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-md border border-black/10 bg-white', className)}>
    <img src={src || '/brand/marble-park-logo-square.png'} alt={`${name} logo`} className={cn('h-full w-full object-contain', imageClassName)} />
  </span>;
}
