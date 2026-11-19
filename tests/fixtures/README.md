Real sample files are NOT committed (they are third-party artwork).
To run the real-file tests set `A2T_FIXTURES` to a folder containing:

- `Boyfriend_But_Better.fla`  (XFL zip, Animate 22)
- `00_baseline.tsproj`        (app-made ToonSquid project, used for key-set comparison)

    A2T_FIXTURES=/path/to/folder npm test

Without the variable those tests are skipped (visibly), they never pass silently.
