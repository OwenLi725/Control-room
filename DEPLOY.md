# Public site

GitHub Pages publishes this repository when `main` changes. The build command is only:

```sh
node landing/assemble.mjs _site
```

That folder is the site: the landing page at `/`, the wallpaper at `/face/`, and the 3D office at `/office/`.

A push to `main` does not start the Mac app build or the Windows package release. Those workflows run for an explicit `mac-v*` or `windows-v*` tag, or a manual dispatch. This repository does not publish the original upstream sites.
