# The offline Bible

`kjv.json` is a complete King James Version, bundled so the Bible widget works
with no connection at all — not just for chapters you happened to open while
online.

## Why a file at all

The widget used to fetch every chapter from [bolls.life](https://bolls.life)
and keep the last 80 in `localStorage`. That meant "offline" really meant
"offline, for the handful of chapters you already read". The only way to read
any chapter on a plane is to have the text on the device.

Bulk-downloading the whole Bible from bolls.life to achieve that is explicitly
against their terms, and would be rude besides. So the KJV — which is public
domain — ships with the app instead, and bolls.life is now called only for
**NKJV**, which cannot be redistributed.

## Where it came from

- **Source:** <https://github.com/thiagobodruk/bible> (`json/en_kjv.json`),
  downloaded 2026-10-06, byte-identical to the file served at that path.
- **Repository licence:** MIT, © 2024 Thiago Bodruk. Full text below.
- **Text licence:** the KJV itself is public domain.

The file is kept exactly as published rather than reformatted, so it can be
diffed against the source to confirm nothing was altered.

## Shape

```jsonc
[                               // 66 books, canonical order: index 0 = Genesis
  {
    "abbrev": "gn",
    "name": "Gênesis",          // Portuguese in the source; unused here
    "chapters": [               // index 0 = chapter 1
      [ "In the beginning…",    // index 0 = verse 1
        "And the earth was…" ]
    ]
  }
]
```

Book names come from `BB_BOOKS` in `index.html`, never from this file — the
`name` field is Portuguese because the source repo ships many languages from
one schema. Verse numbers are positional: `chapters[c-1][v-1]`.

## How it is loaded

Lazily, the first time the Bible widget is opened, and then kept for the
session (`bbLoadLocal()` in `index.html`). It is **not** parsed at app boot;
nobody should pay 4 MB of JSON for a dashboard they opened to tick a task.

The service worker precaches it into **`prodash-bible-kjv-v1`, a cache of its
own that `activate` deliberately does not clear.** That is load-bearing: the
app shell cache is wiped on every `CACHE_VERSION` bump, and if this lived
there, every routine app update would re-download 4 MB. It only changes if
the file itself does, at which point bump the name in `sw.js`.

## MIT License (source repository)

```
MIT License

Copyright (c) 2024 Thiago Bodruk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
