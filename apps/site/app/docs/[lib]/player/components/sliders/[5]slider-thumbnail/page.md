---
description: This component is used to load and display thumbnail images over the time slider.
---

## Usage

The `$tag:media-slider-thumbnail` component can be used to load/parse preview thumbnails from
[WebVTT](#webvtt) files and display them over the time slider.

The thumbnail image will be displayed when the user is hovering over or dragging the time slider,
and the time ranges in the WebVTT file will automatically be matched based on the current pointer
position.

{% code_preview name="usage" copyHighlight=true highlight="html:4-7|react:7" /%}

## WebVTT

The [Web Video Text Tracks](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API) (WebVTT)
format specifies the time ranges of when to display images, with the respective image URL
and coordinates (only required if using a sprite).

- The WebVTT file URL can be absolute `https://foo.com/media/thumbnails.vtt` or relative `/media/thumbnails.vtt`.
- The image URLs specified in the WebVTT file can be absolute
  `https://foo.com/media/thumbnail-1.jpg` or relative `/media/thumbnail-1.jpg`.
- The width and height of each thumbnail image should be kept the same. If sizes differ, the aspect
  ratio should remain the same to avoid jumping when previewing.

### Sprite

Sprites are [large storyboard images](https://media-files.vidstack.io/storyboard.jpg) that contain
multiple small tiled thumbnails. They're preferred over loading [multiple images](#multiple-images)
because:

- Sprites reduce total file size due to compression.
- Avoid loading delays for each thumbnail.
- Reduce the number of server requests.

The WebVTT file must append the coordinates of each thumbnail like so:

```js
WEBVTT

00:00:00.000 --> 00:00:04.629
/media/storyboard.jpg#xywh=0,0,284,160

00:00:04.629 --> 00:00:09.258
/media/storyboard.jpg#xywh=284,0,284,160

...
```

### Multiple Images

[Sprites](#sprite) should generally be preferred but in the case you only have multiple individual
thumbnail images, they can be specified like so:

```js
WEBVTT

00:00:00.000 --> 00:00:04.629
/media/thumbnail-1.jpg

00:00:04.629 --> 00:00:09.258
/media/thumbnail-2.jpg

...
```

## Styling

```css
media-slider-thumbnail {
  /* Min-width applies when scaling thumbnails up. */
  min-width: 120px;
  min-height: 80px;
  /* Max-width applies when scaling thumbnails down. */
  max-width: 180px;
  max-height: 160px;
}

/* Apply styles when thumbnails are loading. */
media-slider-thumbnail[data-loading] {
}

/* Apply styles to image container element part. */
media-slider-thumbnail [part='container'] {
}

/* Apply styles to <img> element part. */
media-slider-thumbnail [part='img'] {
}

/* Apply styles when VTT file fails to load. */
media-slider-thumbnail[data-hidden] {
}
```

## Tailwind

{% code_snippet name="tailwind" copyHighlight=true highlight="html:3-11|react:3-8,11-" /%}

{% callout type="info" %}
A more complete [slider example](/docs/react/player/components/sliders/time-slider#tailwind) is
available in the `$tag:media-time-slider` docs.
{% /callout %}
