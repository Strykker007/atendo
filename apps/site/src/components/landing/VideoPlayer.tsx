import { cn } from '@/lib/utils';
import { glass } from './Section';

/** Vídeo hospedado em public/videos. `preload="metadata"`: só baixa o arquivo quando der play. */
export function VideoPlayer({ src, poster, title, vertical, className }: {
  src: string;
  poster: string;
  title: string;
  /** 9:16 (depoimentos gravados no celular) */
  vertical?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(glass, 'overflow-hidden p-1.5 shadow-xl', vertical ? 'mx-auto w-full max-w-xs' : 'mx-auto w-full max-w-4xl', className)}>
      <video
        src={src}
        poster={poster}
        controls
        preload="metadata"
        playsInline
        controlsList="nodownload"
        aria-label={title}
        className={cn('w-full rounded-xl bg-black object-cover', vertical ? 'aspect-[9/16]' : 'aspect-video')}
      />
    </div>
  );
}
