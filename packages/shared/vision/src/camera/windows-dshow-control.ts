import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  CameraControlMode,
  CameraControlProperty,
  CameraControlValue,
  CameraHardwareControl,
} from './types.js';

interface BridgeResponse {
  id: string;
  ok: boolean;
  controls?: Partial<Record<CameraControlProperty, CameraControlValue>>;
  error?: string;
}

interface PendingRequest {
  resolve(value: BridgeResponse): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export const WINDOWS_DSHOW_CONTROL_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"
$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class MidsceneDshowControl {
  [ComImport, Guid("29840822-5B84-11D0-BD3B-00A0C911CE86"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ICreateDevEnum {
    [PreserveSig] int CreateClassEnumerator([In] ref Guid pType, out IEnumMoniker ppEnumMoniker, int dwFlags);
  }

  [ComImport, Guid("00000102-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IEnumMoniker {
    [PreserveSig] int Next(int celt, out IntPtr rgelt, out int pceltFetched);
    [PreserveSig] int Skip(int celt);
    [PreserveSig] int Reset();
    [PreserveSig] int Clone(out IEnumMoniker ppenum);
  }

  [ComImport, Guid("0000000f-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMoniker {
    void GetClassID(out Guid pClassID);
    [PreserveSig] int IsDirty();
    void Load(IntPtr pStm);
    void Save(IntPtr pStm, bool fClearDirty);
    void GetSizeMax(out ulong pcbSize);
    [PreserveSig] int BindToObject(IntPtr pbc, IntPtr pmkToLeft, ref Guid riidResult, out IntPtr ppvResult);
    void BindToStorage(IntPtr pbc, IntPtr pmkToLeft, ref Guid riid, out IntPtr ppvObj);
    void Reduce(IntPtr pmkToLeft, int dwReduceHowFar, IntPtr ppmkReduced, out int ppmkReducedResult);
    void ComposeWith(IMoniker pmkRight, bool fOnlyIfNotGeneric, out IMoniker ppmkComposite);
    void Enum(bool fForward, out IEnumMoniker ppenum);
    void IsEqual(IMoniker pmkOther);
    void Hash(out int pdwHash);
    void IsRunning(IntPtr pmkNewlyRunning);
    void GetTimeOfLastChange(IntPtr pbc, IntPtr pmkToLeft, out long pfiletime);
    void Inverse(out IMoniker ppmk);
    void CommonPrefixWith(IMoniker pmkOther, out IMoniker ppmkPrefix);
    void RelativePathTo(IMoniker pmkOther, out IMoniker ppmkRelPath);
    [PreserveSig] int GetDisplayName(IntPtr pbc, IntPtr pmkToLeft, out IntPtr ppszDisplayName);
    void ParseDisplayName(IntPtr pbc, IntPtr pmkToLeft, [MarshalAs(UnmanagedType.LPWStr)] string pszDisplayName, out int pchEaten, out IMoniker ppmkOut);
    void IsSystemMoniker(out int pdwMksys);
  }

  [ComImport, Guid("C6E13370-30AC-11D0-A18C-00A0C9118956"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAMCameraControl {
    [PreserveSig] int GetRange(int property, out int min, out int max, out int step, out int defaultValue, out int caps);
    [PreserveSig] int Set(int property, int value, int flags);
    [PreserveSig] int Get(int property, out int value, out int flags);
  }

  [ComImport, Guid("C6E13360-30AC-11D0-A18C-00A0C9118956"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAMVideoProcAmp {
    [PreserveSig] int GetRange(int property, out int min, out int max, out int step, out int defaultValue, out int caps);
    [PreserveSig] int Set(int property, int value, int flags);
    [PreserveSig] int Get(int property, out int value, out int flags);
  }

  static readonly Dictionary<int, object> filters = new Dictionary<int, object>();

  static object Filter(int index) {
    object cached;
    if (filters.TryGetValue(index, out cached)) return cached;

    Guid category = new Guid("860BB310-5D01-11D0-BD3B-00A0C911CE86");
    object creatorObject = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("62BE5D10-60EB-11D0-BD3B-00A0C911CE86")));
    ICreateDevEnum creator = (ICreateDevEnum)creatorObject;
    IEnumMoniker enumerator;
    int hr = creator.CreateClassEnumerator(ref category, out enumerator, 0);
    if (hr != 0 || enumerator == null) throw new Exception("No DirectShow video devices");

    int current = 0;
    try {
      while (true) {
        IntPtr monikerPointer;
        int fetched;
        hr = enumerator.Next(1, out monikerPointer, out fetched);
        if (hr != 0 || fetched != 1 || monikerPointer == IntPtr.Zero) break;
        object monikerObject = null;
        try {
          monikerObject = Marshal.GetObjectForIUnknown(monikerPointer);
          if (current == index) {
            IMoniker moniker = (IMoniker)monikerObject;
            Guid filterIid = new Guid("56A86895-0AD4-11CE-B03A-0020AF0BA770");
            IntPtr filterPointer;
            hr = moniker.BindToObject(IntPtr.Zero, IntPtr.Zero, ref filterIid, out filterPointer);
            if (hr != 0 || filterPointer == IntPtr.Zero)
              throw new Exception("Could not bind DirectShow video filter " + index);
            object filter = Marshal.GetObjectForIUnknown(filterPointer);
            Marshal.Release(filterPointer);
            filters[index] = filter;
            return filter;
          }
          current++;
        } finally {
          Marshal.Release(monikerPointer);
          if (monikerObject != null && Marshal.IsComObject(monikerObject))
            Marshal.ReleaseComObject(monikerObject);
        }
      }
    } finally {
      if (Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
      if (Marshal.IsComObject(creatorObject)) Marshal.ReleaseComObject(creatorObject);
    }
    throw new Exception("DirectShow video device index is unavailable: " + index);
  }

  static Dictionary<string, object> Read(IAMCameraControl camera, int property, string name) {
    int min, max, step, defaultValue, caps;
    int hr = camera.GetRange(property, out min, out max, out step, out defaultValue, out caps);
    if (hr != 0) return null;
    int value, flags;
    hr = camera.Get(property, out value, out flags);
    if (hr != 0) return null;
    Dictionary<string, object> result = new Dictionary<string, object>();
    result["property"] = name;
    result["value"] = value;
    result["mode"] = (flags & 1) != 0 ? "auto" : "manual";
    result["min"] = min;
    result["max"] = max;
    result["step"] = Math.Max(1, Math.Abs(step));
    result["default"] = defaultValue;
    result["supportsAuto"] = (caps & 1) != 0;
    result["supportsManual"] = (caps & 2) != 0;
    return result;
  }

  static Dictionary<string, object> ReadAmp(IAMVideoProcAmp camera, int property, string name) {
    int min, max, step, defaultValue, caps;
    int hr = camera.GetRange(property, out min, out max, out step, out defaultValue, out caps);
    if (hr != 0) return null;
    int value, flags;
    hr = camera.Get(property, out value, out flags);
    if (hr != 0) return null;
    Dictionary<string, object> result = new Dictionary<string, object>();
    result["property"] = name;
    result["value"] = value;
    result["mode"] = (flags & 1) != 0 ? "auto" : "manual";
    result["min"] = min;
    result["max"] = max;
    result["step"] = Math.Max(1, Math.Abs(step));
    result["default"] = defaultValue;
    result["supportsAuto"] = (caps & 1) != 0;
    result["supportsManual"] = (caps & 2) != 0;
    return result;
  }

  public static Dictionary<string, object> Query(int index) {
    object filter = Filter(index);
    IAMCameraControl camera = (IAMCameraControl)filter;
    IAMVideoProcAmp amp = (IAMVideoProcAmp)filter;
    Dictionary<string, object> controls = new Dictionary<string, object>();
    Dictionary<string, object> exposure = Read(camera, 4, "exposure");
    Dictionary<string, object> focus = Read(camera, 6, "focus");
    Dictionary<string, object> brightness = ReadAmp(amp, 0, "brightness");
    Dictionary<string, object> contrast = ReadAmp(amp, 1, "contrast");
    Dictionary<string, object> whiteBalance = ReadAmp(amp, 7, "whiteBalance");
    Dictionary<string, object> gain = ReadAmp(amp, 9, "gain");
    if (exposure != null) controls["exposure"] = exposure;
    if (focus != null) controls["focus"] = focus;
    if (brightness != null) controls["brightness"] = brightness;
    if (contrast != null) controls["contrast"] = contrast;
    if (whiteBalance != null) controls["whiteBalance"] = whiteBalance;
    if (gain != null) controls["gain"] = gain;
    return controls;
  }

  public static void Set(int index, string name, int value, string mode) {
    int flags = mode == "auto" ? 1 : 2;
    int hr;
    if (name == "gain" || name == "brightness" || name == "contrast" || name == "whiteBalance") {
      IAMVideoProcAmp amp = (IAMVideoProcAmp)Filter(index);
      int property =
        name == "gain" ? 9 :
        name == "brightness" ? 0 :
        name == "contrast" ? 1 : 7;
      hr = amp.Set(property, value, flags);
    } else {
      IAMCameraControl camera = (IAMCameraControl)Filter(index);
      int property = name == "exposure" ? 4 : name == "focus" ? 6 : -1;
      if (property < 0) throw new Exception("Unsupported camera property: " + name);
      hr = camera.Set(property, value, flags);
    }
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
  }

  public static void Clear() {
    foreach (object filter in filters.Values) {
      if (filter != null && Marshal.IsComObject(filter)) Marshal.ReleaseComObject(filter);
    }
    filters.Clear();
  }
}
'@
Add-Type -TypeDefinition $source -Language CSharp

[Console]::Out.WriteLine('{"id":"ready","ok":true}')
[Console]::Out.Flush()

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $id = ""
  try {
    $command = ConvertFrom-Json $line
    $id = [string]$command.id
    if ($command.action -eq "query") {
      $controls = [MidsceneDshowControl]::Query([int]$command.index)
      $response = @{ id = $id; ok = $true; controls = $controls }
    } elseif ($command.action -eq "set") {
      [MidsceneDshowControl]::Set(
        [int]$command.index,
        [string]$command.property,
        [int]$command.value,
        [string]$command.mode
      )
      $response = @{ id = $id; ok = $true }
    } elseif ($command.action -eq "clear") {
      [MidsceneDshowControl]::Clear()
      $response = @{ id = $id; ok = $true }
    } elseif ($command.action -eq "shutdown") {
      [MidsceneDshowControl]::Clear()
      [Console]::Out.WriteLine((@{ id = $id; ok = $true } | ConvertTo-Json -Compress))
      [Console]::Out.Flush()
      break
    } else {
      throw "Unknown command: $($command.action)"
    }
  } catch {
    $response = @{ id = $id; ok = $false; error = [string]$_.Exception.Message }
  }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 8))
  [Console]::Out.Flush()
}
`;

export class WindowsDshowHardwareControl implements CameraHardwareControl {
  private child?: ChildProcessWithoutNullStreams;
  private opened = false;
  private ready = false;
  private closing = false;
  private stdout = '';
  private stderr = '';
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    readonly deviceId: string,
    private readonly index: number,
    private readonly name: string,
  ) {}

  async open(): Promise<void> {
    if (this.opened) return;
    if (process.platform !== 'win32')
      throw new Error(
        'DirectShow camera controls are available on Windows only',
      );
    const encoded = Buffer.from(
      WINDOWS_DSHOW_CONTROL_SCRIPT,
      'utf16le',
    ).toString('base64');
    const tempDirectory =
      process.env.MIDSCENE_CAMERA_CONTROL_TEMP ||
      path.join(process.cwd(), '.midscene', 'camera-control-temp');
    mkdirSync(tempDirectory, { recursive: true });
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encoded,
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          TEMP: tempDirectory,
          TMP: tempDirectory,
        },
      },
    );
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.readStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4000);
    });
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code, signal) =>
      this.fail(
        new Error(
          `DirectShow control process exited (code=${code}, signal=${signal})${
            this.stderr ? `: ${this.stderr.trim()}` : ''
          }`,
        ),
      ),
    );
    const ready = await this.waitForReady(20_000);
    if (!ready)
      throw new Error('DirectShow control process did not become ready');
    this.opened = true;
  }

  async read(): Promise<
    Partial<Record<CameraControlProperty, CameraControlValue>>
  > {
    const response = await this.request({ action: 'query', index: this.index });
    return response.controls ?? {};
  }

  async set(
    property: CameraControlProperty,
    value: number,
    mode: CameraControlMode,
  ): Promise<void> {
    await this.request({
      action: 'set',
      index: this.index,
      property,
      value,
      mode,
    });
  }

  async close(): Promise<void> {
    if (!this.child || this.closing) return;
    this.closing = true;
    try {
      await this.request({ action: 'shutdown' }, 2_000);
    } catch {
      // The child may already be gone.
    }
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child?.kill();
        resolve();
      }, 1_000);
      this.child?.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = undefined;
    this.opened = false;
    this.ready = false;
  }

  private waitForReady(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (this.child?.exitCode !== null) {
          clearInterval(timer);
          reject(
            new Error(
              `DirectShow control process failed to start${
                this.stderr ? `: ${this.stderr.trim()}` : ''
              }`,
            ),
          );
        } else if (this.ready) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(
            new Error(
              `DirectShow control process did not become ready${
                this.stderr ? `: ${this.stderr.trim()}` : ''
              }`,
            ),
          );
        }
      }, 25);
    });
  }

  private request(
    command: Record<string, unknown>,
    timeoutMs = 8_000,
  ): Promise<BridgeResponse> {
    if (!this.child || !this.opened)
      return Promise.reject(
        new Error(`DirectShow control is not open for ${this.name}`),
      );
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`DirectShow control command timed out: ${command.action}`),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  private readStdout(chunk: string) {
    this.stdout += chunk;
    while (true) {
      const newline = this.stdout.indexOf('\n');
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      let response: BridgeResponse;
      try {
        response = JSON.parse(line) as BridgeResponse;
      } catch {
        this.stderr = `${this.stderr}\n${line}`.slice(-4000);
        continue;
      }
      if (response.id === 'ready' && response.ok) {
        this.ready = true;
        continue;
      }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.ok) pending.resolve(response);
      else
        pending.reject(
          new Error(response.error || 'DirectShow control command failed'),
        );
    }
  }

  private fail(error: Error) {
    if (this.closing) return;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
