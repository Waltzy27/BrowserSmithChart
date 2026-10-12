Browser Smith Chart __VERSION__ - offline package for Linux
=========================================================

RUN IT
  Double-click BrowserSmithChart.html. It opens in your web browser (Firefox on
  Pop!_OS) and works with no internet connection and nothing to install.
  The whole app (code, fonts, equations, example data files) is inside that one file.

ADD IT TO THE APP MENU (optional)
  In a terminal, in this folder:
      bash install-launcher.sh
  Then press Super and search "Smith Chart". The app is copied to
  ~/.local/share/browser-smith-chart, so you can delete this folder afterwards.
  To remove it:  bash uninstall-launcher.sh

SAVED WORK
  Autosave and the project library are kept in the browser's storage for this file.
  If you move or rename the HTML file, or open it in a different browser, it starts
  fresh. Use Data > Save project to keep a portable .json copy of your work, and
  Data > Open project to load it anywhere (including the online version).

DIFFERENCES FROM THE ONLINE VERSION
  - The version menu cannot list other versions while offline.
  - Large Touchstone files are parsed on the main thread (browsers block background
    workers for files opened from disk); this only matters for files of many MB.

Online version: https://waltzy27.github.io/BrowserSmithChart/
Source and releases: https://github.com/Waltzy27/BrowserSmithChart
