import { isString } from 'maverick.js/std';

import { isHLSSrc, VIDEO_EXTENSIONS, VIDEO_TYPES } from '../../../../utils/mime';
import { canPlayHLSNatively } from '../../../../utils/support';
import type { MediaContext } from '../../context';
import type { MediaStore } from '../../store';
import type { MediaSrc, MediaType } from '../../types';
import type { MediaProviderLoader } from '../types';
import type { VideoProvider } from './provider';

export class VideoProviderLoader implements MediaProviderLoader<VideoProvider> {
  _video!: HTMLVideoElement;

  canPlay(src: MediaSrc) {
    return isString(src.src)
      ? VIDEO_EXTENSIONS.test(src.src) ||
          VIDEO_TYPES.has(src.type) ||
          (src.src.startsWith('blob:') && src.type === 'video/object') ||
          (isHLSSrc(src) && (__SERVER__ || canPlayHLSNatively()))
      : src.type === 'video/object';
  }

  mediaType(): MediaType {
    return 'video';
  }

  async load(context: MediaContext) {
    if (__DEV__ && !this._video) {
      throw Error(
        '[vidstack] `<video>` element was not found - did you forget to include `<media-outlet>`?',
      );
    }

    return new (await import('./provider')).VideoProvider(this._video, context);
  }

  render($store: MediaStore) {
    if (__SERVER__) {
      const src = $store.source.src;
      return (
        <video
          src={isString(src) ? src : null}
          poster={$store.poster}
          muted={$store.muted}
          controls={$store.controls}
          playsinline={$store.playsinline}
          preload="none"
        ></video>
      );
    }

    const controls = () => $store.controls;
    // === `true` because it's `null` to start with until we know if the poster can load.
    const poster = () => ($store.poster && $store.canLoadPoster === true ? $store.poster : null);

    return (
      <video
        controls={controls()}
        poster={poster()}
        preload="none"
        $ref={(el) => void (this._video = el)}
      ></video>
    );
  }
}
