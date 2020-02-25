import * as path from "path";
import { URL } from "url";

import { getDenoDepsDir } from "./deno";
import { Manifest } from "./manifest";
import { str2regexpStr } from "./util";

export interface DenoCacheModule {
  filepath: string;
  url: string;
  resolveModule(moduleName: string): DenoCacheModule | void;
}

export class CacheModule implements DenoCacheModule {
  static create(filepath: string): DenoCacheModule | void {
    const DENO_DEPS_DIR = getDenoDepsDir();
    // if not a Deno deps module
    if (filepath.indexOf(DENO_DEPS_DIR) !== 0) {
      return;
    }

    const hash = path.basename(filepath);
    const originDir = path.dirname(filepath);
    const manifestFilepath = path.join(originDir, "manifest.json");
    // $DENO_DIR/deps/https/deno.land -> https://deno.land
    const origin = originDir
      .replace(new RegExp("^" + str2regexpStr(DENO_DEPS_DIR + path.sep)), "")
      .replace(new RegExp(str2regexpStr(path.sep), "gm"), "/")
      .replace(/^(https?)\//, "$1://");

    const manifest = Manifest.create(manifestFilepath);

    if (!manifest) {
      return;
    }

    const urlPathAndQuery = manifest.getUrlPathFromHash(hash);

    if (!urlPathAndQuery) {
      return;
    }

    const url = origin + urlPathAndQuery;
    return new CacheModule(filepath, url, manifest);
  }

  constructor(
    public filepath: string,
    public url: string,
    private manifest: Manifest
  ) {}
  /**
   * Resolve module in this cache file
   * @param moduleName The module name is for unix style
   */
  resolveModule(moduleName: string): DenoCacheModule | void {
    // eg. import "/npm:tough-cookie@3?dew"
    if (moduleName.indexOf("/") === 0) {
      const fileHash = this.manifest.getHashFromUrlPath(moduleName);

      if (!fileHash) {
        return;
      }

      const originDir = path.dirname(this.filepath);
      const targetFilepath = path.join(originDir, fileHash);

      return CacheModule.create(targetFilepath);
    }
    // eg. import "./sub/mod.ts"
    else if (moduleName.indexOf(".") === 0) {
      const originDir = path.dirname(this.filepath);
      const currentUrlPath = new URL(this.url);

      const targetUrlPath = path.posix.resolve(
        path.posix.dirname(currentUrlPath.pathname),
        moduleName
      );
      const fileHash = this.manifest.getHashFromUrlPath(targetUrlPath);

      // if file hash not exist. then module not found.
      if (!fileHash) {
        return;
      }

      const targetFilepath = path.join(originDir, fileHash);

      return CacheModule.create(targetFilepath);
    }
    // eg import "https://example.com/demo/mod.ts"
    else if (/http?s:\/\//.test(moduleName)) {
      let url: URL;
      try {
        url = new URL(moduleName);
      } catch {
        return;
      }
      const targetOriginDir = path.join(
        getDenoDepsDir(),
        url.protocol.replace(/:$/, ""), // https: -> https
        url.hostname
      );

      const manifest = Manifest.create(
        path.join(targetOriginDir, "manifest.json")
      );

      if (!manifest) {
        return;
      }

      const hash = manifest.getHashFromUrlPath(url.pathname + url.search);

      if (!hash) {
        return;
      }

      return CacheModule.create(path.join(targetOriginDir, hash));
    }
  }
}
