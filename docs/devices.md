# Playback devices

Open Decibel with the same profile and server on several devices and use **Dispositivos** (devices) to choose
where the music plays. The picker is in the desktop player bar, the mobile navigation and the full-screen player.

Switching keeps the song, the position and the queue. Play, pause, skip, searching for another song, editing the
queue and changing the volume from any other device control the selected output. Only the device that plays
records the listens. With no device selected, pressing a playback control makes the device you are using take over.

Devices appear while a compatible version of Decibel is open and connected. The native apps bundle their own UI, so
they need a release that includes this feature. A receiving browser may require pressing **Reproducir** there once
to allow audio. If the system suspends a tab or the app in the background, it may stop being available. The picker
does not discover Bluetooth speakers, Chromecast or older clients; use the system picker for those outputs.

Sessions are private to each profile, are only enabled with the music source of the same server and are kept in
memory. Every browser tab is a separate output. After a server restart, clients register again. Up to 32 devices
per profile and queues of up to 1000 songs are supported.

## Library sync

Each device checks a cheap library revision (`GET /api/me/revision`, a fingerprint of the likes and visible
playlists) every 15 s, when the window gets focus and when it becomes visible, and reloads the library when another
device or an import changed it.

## API

The authenticated `/api/devices/{heartbeat,transfer,command}` endpoints take JSON over POST. Clients poll about
once a second, and a device disappears after 20 seconds without answering. Commands carry a sequence number and
are kept until the output confirms them. Every transfer invalidates earlier commands and waits until the previous
output confirms that it stopped the audio, or until its 8-second lease expires. A client stops its audio before
the lease expires if it cannot renew it. Background restrictions of the browser or the operating system also
affect these timers.
