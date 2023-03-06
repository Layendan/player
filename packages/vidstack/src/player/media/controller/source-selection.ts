import { computed, effect, peek, ReadSignal, signal, tick } from 'maverick.js';
import { isArray, isString } from 'maverick.js/std';

import { preconnect } from '../../../utils/network';
import type { MediaContext } from '../context';
import { AudioProviderLoader } from '../providers/audio/loader';
import { HLSProviderLoader } from '../providers/hls/loader';
import type { MediaProviderLoader } from '../providers/types';
import { VideoProviderLoader } from '../providers/video/loader';
import type { MediaSrc } from '../types';
import type { MediaControllerProps } from './types';

export function useSourceSelection(
  $src: ReadSignal<MediaControllerProps['src']>,
  $preferNativeHLS: ReadSignal<MediaControllerProps['preferNativeHLS']>,
  context: MediaContext,
): void {
  const { $loader, $store, delegate } = context;

  const HLS_LOADER = new HLSProviderLoader(),
    VIDEO_LOADER = new VideoProviderLoader(),
    AUDIO_LOADER = new AudioProviderLoader();

  const $loaders = computed<MediaProviderLoader[]>(() => {
    return $preferNativeHLS()
      ? [VIDEO_LOADER, AUDIO_LOADER, HLS_LOADER]
      : [HLS_LOADER, VIDEO_LOADER, AUDIO_LOADER];
  });

  if (__SERVER__) {
    $store.sources = normalizeSrc($src());
    for (const src of $store.sources) {
      const loader = $loaders().find((loader) => loader.canPlay(src));
      if (loader) {
        $store.source = src;
        $store.mediaType = loader.mediaType(src);
        $loader.set(loader);
      }
    }
    return;
  }

  effect(() => {
    delegate.dispatch('sources-change', { detail: normalizeSrc($src()) });
  });

  effect(() => {
    // Read sources off store here because it's normalized above.
    const sources = $store.sources,
      currentSource = peek(() => $store.source);

    let newSource: MediaSrc = { src: '', type: '' },
      newLoader: MediaProviderLoader | null = null;

    for (const src of sources) {
      const loader = peek($loaders).find((loader) => loader.canPlay(src));
      if (loader) {
        newSource = src;
        newLoader = loader;
      }
    }

    if (newSource.src !== currentSource.src || newSource.type !== currentSource.type) {
      delegate.dispatch('source-change', { detail: newSource });
      delegate.dispatch('media-type-change', {
        detail: newLoader?.mediaType(newSource) || 'unknown',
      });
    }

    if (newLoader !== peek($loader)) {
      delegate.dispatch('provider-change', { detail: null });
      newLoader && peek(() => newLoader!.preconnect?.(context));
      delegate.dispatch('provider-loader-change', { detail: newLoader });
    }

    tick();
  });

  // !!! The loader is attached inside the `<MediaOutlet>` because it requires rendering. !!!

  effect(() => {
    const provider = context.$provider();
    if (!provider) return;
    if (context.$store.canLoad) {
      peek(() => provider.setup({ ...context, player: context.$player()! }));
      return;
    }
    peek(() => provider.preconnect?.(context));
  });

  effect(() => {
    const provider = context.$provider(),
      source = context.$store.source;

    if (context.$store.canLoad) {
      peek(() =>
        provider?.loadSource(
          source,
          peek(() => context.$store.preload),
        ),
      );
      return;
    }

    try {
      isString(source.src) && preconnect(new URL(source.src).origin, 'preconnect');
    } catch (e) {
      if (__DEV__) {
        context.logger
          ?.infoGroup(`Failed to preconnect to source: ${source.src}`)
          .labelledLog('Error', e)
          .dispatch();
      }
    }
  });
}

function normalizeSrc(src: MediaControllerProps['src']): MediaSrc[] {
  return (isArray(src) ? src : [!isString(src) && 'src' in src ? src : { src }]).map(
    ({ src, type }) => ({
      src,
      type: type ?? (!isString(src) || src.startsWith('blob:') ? 'video/object' : '?'),
    }),
  );
}
