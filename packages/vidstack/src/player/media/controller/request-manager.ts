import { effect, peek, ReadSignal, signal, Signals } from 'maverick.js';
import { createEvent, isUndefined, keysOf, listenEvent, noop } from 'maverick.js/std';

import {
  createFullscreenAdapter,
  FullscreenAdapter,
} from '../../../foundation/fullscreen/fullscreen';
import {
  createScreenOrientationAdapter,
  ScreenOrientationAdapter,
} from '../../../foundation/orientation/screen-orientation';
import { Queue } from '../../../foundation/queue/queue';
import { coerceToError } from '../../../utils/error';
import type { MediaPlayerElement } from '../../element/types';
import type { MediaContext } from '../context';
import type { MediaProvider } from '../providers/types';
import type * as RE from '../request-events';
import { createMediaUser, MediaUser } from '../user';
import type { MediaStateManager } from './state-manager';
import type { MediaControllerProps } from './types';

/**
 * This hook is responsible for listening to media request events and calling the appropriate
 * actions on the current media provider. Do note that we queue actions until a media provider
 * has connected.
 */
export function createMediaRequestManager(
  { $player, $store: $media, $provider, logger }: MediaContext,
  handler: MediaStateManager,
  requests: MediaRequestContext,
  $props: Signals<MediaControllerProps>,
): MediaRequestManager {
  const user = createMediaUser($player, $media),
    orientation = createScreenOrientationAdapter($player),
    fullscreen = createFullscreenAdapter($player);

  if (__SERVER__) {
    return {
      _user: user,
      _orientation: orientation,
      _play: noop as () => Promise<void>,
      _pause: noop as () => Promise<void>,
      _seekToLiveEdge: noop,
      _enterFullscreen: noop as () => Promise<void>,
      _exitFullscreen: noop as () => Promise<void>,
    };
  }

  effect(() => {
    user.idle.delay = $props.$userIdleDelay();
  });

  effect(() => {
    const supported = fullscreen.supported || $provider()?.fullscreen?.supported || false;
    if ($media.canLoad && peek(() => $media.canFullscreen) === supported) return;
    $media.canFullscreen = supported;
  });

  function logRequest(event: Event) {
    if (__DEV__) {
      logger?.infoGroup(`📬 received \`${event.type}\``).labelledLog('Request', event).dispatch();
    }
  }

  const eventHandlers = {
    'media-start-loading': onStartLoading,
    'media-mute-request': onMuteRequest,
    'media-unmute-request': onUnmuteRequest,
    'media-play-request': onPlayRequest,
    'media-pause-request': onPauseRequest,
    'media-seeking-request': onSeekingRequest,
    'media-seek-request': onSeekRequest,
    'media-live-edge-request': onSeekToLiveEdgeRequest,
    'media-volume-change-request': onVolumeChangeRequest,
    'media-enter-fullscreen-request': onEnterFullscreenRequest,
    'media-exit-fullscreen-request': onExitFullscreenRequest,
    'media-resume-user-idle-request': onResumeIdlingRequest,
    'media-pause-user-idle-request': onPauseIdlingRequest,
    'media-show-poster-request': onShowPosterRequest,
    'media-hide-poster-request': onHidePosterRequest,
    'media-loop-request': onLoopRequest,
  };

  effect(() => {
    const target = $player();
    if (!target) return;
    for (const eventType of keysOf(eventHandlers)) {
      const handler = eventHandlers[eventType];
      listenEvent(target, eventType, (event) => {
        event.stopPropagation();
        if (__DEV__) logRequest(event);
        if (peek($provider)) handler(event as any);
      });
    }
  });

  function onStartLoading(event: RE.MediaStartLoadingRequestEvent) {
    if ($media.canLoad) return;
    requests._queue._enqueue('load', event);
    handler.handle(createEvent($player, 'can-load'));
  }

  function onMuteRequest(event: RE.MediaMuteRequestEvent) {
    if ($media.muted) return;
    requests._queue._enqueue('volume', event);
    $provider()!.muted = true;
  }

  function onUnmuteRequest(event: RE.MediaUnmuteRequestEvent) {
    if (!$media.muted) return;
    requests._queue._enqueue('volume', event);
    $provider()!.muted = false;
    if ($media.volume === 0) {
      requests._queue._enqueue('volume', event);
      $provider()!.volume = 0.25;
    }
  }

  async function onPlayRequest(event: RE.MediaPlayRequestEvent) {
    if (!$media.paused) return;
    try {
      requests._queue._enqueue('play', event);
      await $provider()!.play();
    } catch (e) {
      const errorEvent = createEvent($player, 'play-fail', { detail: coerceToError(e) });
      handler.handle(errorEvent);
    }
  }

  async function onPauseRequest(event: RE.MediaPauseRequestEvent) {
    if ($media.paused) return;
    try {
      requests._queue._enqueue('pause', event);
      await $provider()!.pause();
    } catch (e) {
      requests._queue._delete('pause');
      if (__DEV__) logger?.error('pause-fail', e);
    }
  }

  function onSeekingRequest(event: RE.MediaSeekingRequestEvent) {
    requests._queue._enqueue('seeking', event);
    $media.seeking = true;
    requests._$isSeeking.set(true);
  }

  function onSeekRequest(event: RE.MediaSeekRequestEvent) {
    if ($media.ended) requests._$isReplay.set(true);

    requests._$isSeeking.set(false);
    requests._queue._delete('seeking');

    const boundTime = Math.min(
      Math.max($media.seekableStart + 0.1, event.detail),
      $media.seekableEnd - 0.1,
    );

    if (!Number.isFinite(boundTime) || !$media.canSeek) return;

    requests._queue._enqueue('seeked', event);
    $provider()!.currentTime = boundTime;

    if ($media.live && event.isOriginTrusted && Math.abs($media.seekableEnd - boundTime) >= 2) {
      $media.userBehindLiveEdge = true;
    }
  }

  function onSeekToLiveEdgeRequest(event: RE.MediaLiveEdgeRequestEvent) {
    if (!$media.live || $media.liveEdge || !$media.canSeek) return;
    requests._queue._enqueue('seeked', event);
    try {
      seekToLiveEdge();
    } catch (e) {
      if (__DEV__) logger?.error('seek to live edge fail', e);
    }
  }

  function onVolumeChangeRequest(event: RE.MediaVolumeChangeRequestEvent) {
    const volume = event.detail;
    if ($media.volume === volume) return;
    requests._queue._enqueue('volume', event);
    $provider()!.volume = volume;
    if (volume > 0 && $media.muted) {
      requests._queue._enqueue('volume', event);
      $provider()!.muted = false;
    }
  }

  async function onEnterFullscreenRequest(event: RE.MediaEnterFullscreenRequestEvent) {
    try {
      requests._queue._enqueue('fullscreen', event);
      await enterFullscreen(event.detail);
    } catch (e) {
      const errorEvent = createEvent($player, 'fullscreen-error', { detail: coerceToError(e) });
      handler.handle(errorEvent);
    }
  }

  async function onExitFullscreenRequest(event: RE.MediaExitFullscreenRequestEvent) {
    try {
      requests._queue._enqueue('fullscreen', event);
      await exitFullscreen(event.detail);
    } catch (e) {
      const errorEvent = createEvent($player, 'fullscreen-error', { detail: coerceToError(e) });
      handler.handle(errorEvent);
    }
  }

  function onResumeIdlingRequest(event: RE.MediaResumeUserIdleRequestEvent) {
    requests._queue._enqueue('userIdle', event);
    user.idle.paused = false;
  }

  function onPauseIdlingRequest(event: RE.MediaPauseUserIdleRequestEvent) {
    requests._queue._enqueue('userIdle', event);
    user.idle.paused = true;
  }

  function onShowPosterRequest(event: RE.MediaShowPosterRequestEvent) {
    $media.canLoadPoster = true;
  }

  function onHidePosterRequest(event: RE.MediaHidePosterRequestEvent) {
    $media.canLoadPoster = false;
  }

  function onLoopRequest(event: RE.MediaLoopRequestEvent) {
    window.requestAnimationFrame(async () => {
      try {
        requests._$isLooping.set(true);
        requests._$isReplay.set(true);
        await play();
      } catch (e) {
        requests._$isLooping.set(false);
        requests._$isReplay.set(false);
      }
    });
  }

  function throwIfFullscreenNotSupported(
    target: RE.MediaFullscreenRequestTarget,
    fullscreen?: FullscreenAdapter,
  ) {
    if (fullscreen?.supported) return;
    throw Error(
      __DEV__
        ? `[vidstack] fullscreen is not currently available on target \`${target}\``
        : '[vidstack] no fullscreen support',
    );
  }

  async function play() {
    if (!$media.paused) return;
    try {
      const provider = peek($provider);
      throwIfNotReadyForPlayback(provider, $player);
      if (peek(() => $media.ended)) provider!.currentTime = $media.seekableStart + 0.1;
      return provider!.play();
    } catch (error) {
      const errorEvent = createEvent($player, 'play-fail', { detail: coerceToError(error) });
      errorEvent.autoplay = $media.attemptingAutoplay;
      handler.handle(errorEvent);
      throw error;
    }
  }

  async function pause() {
    if ($media.paused) return;
    const provider = peek($provider);
    throwIfNotReadyForPlayback(provider, $player);
    return provider!.pause();
  }

  async function enterFullscreen(target: RE.MediaFullscreenRequestTarget = 'prefer-media') {
    const provider = peek($provider),
      fs =
        (target === 'prefer-media' && fullscreen.supported) || target === 'media'
          ? fullscreen
          : provider?.fullscreen;

    throwIfFullscreenNotSupported(target, fs);
    if (fs!.active) return;

    // TODO: Check if PiP is active, if so make sure to exit.
    const lockType = peek($props.$fullscreenOrientation);
    if (orientation.supported && !isUndefined(lockType)) await orientation.lock(lockType);

    return fs!.enter();
  }

  async function exitFullscreen(target: RE.MediaFullscreenRequestTarget = 'prefer-media') {
    const provider = peek($provider),
      fs =
        (target === 'prefer-media' && fullscreen.supported) || target === 'media'
          ? fullscreen
          : provider?.fullscreen;

    throwIfFullscreenNotSupported(target, fs);
    if (!fs!.active) return;

    if (orientation.locked) await orientation.unlock();
    // TODO: If PiP was active put it back _after_ exiting.

    return fs!.exit();
  }

  function seekToLiveEdge() {
    $media.userBehindLiveEdge = false;
    if (peek(() => !$media.live || $media.liveEdge || !$media.canSeek)) return;
    const provider = peek($provider);
    throwIfNotReadyForPlayback(provider, $player);
    provider!.currentTime = $media.liveSyncPosition ?? $media.seekableEnd - 2;
  }

  return {
    _user: user,
    _orientation: orientation,
    _play: play,
    _pause: pause,
    _enterFullscreen: enterFullscreen,
    _exitFullscreen: exitFullscreen,
    _seekToLiveEdge: seekToLiveEdge,
  };
}

function throwIfNotReadyForPlayback(
  provider: MediaProvider | null,
  $player: ReadSignal<MediaPlayerElement | null>,
) {
  if (provider && peek(() => $player()?.state.canPlay)) return;
  throw Error(
    __DEV__
      ? `[vidstack] media is not ready - wait for \`can-play\` event.`
      : '[vidstack] media not ready',
  );
}

export class MediaRequestContext {
  _queue = new Queue<MediaRequestQueueRecord>();
  _$isSeeking = signal(false);
  _$isLooping = signal(false);
  _$isReplay = signal(false);
}

export interface MediaRequestQueueRecord {
  load: RE.MediaStartLoadingRequestEvent;
  play: RE.MediaPlayRequestEvent;
  pause: RE.MediaPauseRequestEvent;
  volume: RE.MediaVolumeChangeRequestEvent | RE.MediaMuteRequestEvent | RE.MediaUnmuteRequestEvent;
  fullscreen: RE.MediaEnterFullscreenRequestEvent | RE.MediaExitFullscreenRequestEvent;
  seeked: RE.MediaSeekRequestEvent | RE.MediaLiveEdgeRequestEvent;
  seeking: RE.MediaSeekingRequestEvent;
  userIdle: RE.MediaResumeUserIdleRequestEvent | RE.MediaPauseUserIdleRequestEvent;
}

export interface MediaRequestManager {
  _user: MediaUser;
  _orientation: ScreenOrientationAdapter;
  _play(): Promise<void>;
  _pause(): Promise<void>;
  _seekToLiveEdge(): void;
  _enterFullscreen(target?: RE.MediaFullscreenRequestTarget): Promise<void>;
  _exitFullscreen(target?: RE.MediaFullscreenRequestTarget): Promise<void>;
}
