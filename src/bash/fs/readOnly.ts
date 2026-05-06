import type {
  CpOptions,
  FileContent,
  FsStat,
  IFileSystem,
  MkdirOptions,
  RmOptions,
} from "just-bash";

export class ReadOnlyFs implements IFileSystem {
  constructor(private readonly inner: IFileSystem) {}

  readFile(
    path: string,
    options?: Parameters<IFileSystem["readFile"]>[1],
  ): Promise<string> {
    return this.inner.readFile(path, options);
  }

  readFileBuffer(path: string): Promise<Uint8Array> {
    return this.inner.readFileBuffer(path);
  }

  writeFile(
    path: string,
    _content: FileContent,
    _options?: Parameters<IFileSystem["writeFile"]>[2],
  ): Promise<void> {
    return Promise.reject(erofs(path));
  }

  appendFile(
    path: string,
    _content: FileContent,
    _options?: Parameters<IFileSystem["appendFile"]>[2],
  ): Promise<void> {
    return Promise.reject(erofs(path));
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }

  stat(path: string): Promise<FsStat> {
    return this.inner.stat(path);
  }

  mkdir(path: string, _options?: MkdirOptions): Promise<void> {
    return Promise.reject(erofs(path));
  }

  readdir(path: string): Promise<string[]> {
    return this.inner.readdir(path);
  }

  readdirWithFileTypes(
    path: string,
  ): ReturnType<NonNullable<IFileSystem["readdirWithFileTypes"]>> {
    if (this.inner.readdirWithFileTypes) {
      return this.inner.readdirWithFileTypes(path);
    }
    return this.inner.readdir(path).then(async (names) => {
      const entries = await Promise.all(
        names.map(async (name) => {
          const st = await this.inner.stat(this.inner.resolvePath(path, name));
          return {
            name,
            isFile: st.isFile,
            isDirectory: st.isDirectory,
            isSymbolicLink: st.isSymbolicLink,
          };
        }),
      );
      return entries;
    });
  }

  rm(path: string, _options?: RmOptions): Promise<void> {
    return Promise.reject(erofs(path));
  }

  cp(_src: string, dest: string, _options?: CpOptions): Promise<void> {
    return Promise.reject(erofs(dest));
  }

  mv(_src: string, dest: string): Promise<void> {
    return Promise.reject(erofs(dest));
  }

  resolvePath(base: string, path: string): string {
    return this.inner.resolvePath(base, path);
  }

  getAllPaths(): string[] {
    return this.inner.getAllPaths();
  }

  chmod(path: string, _mode: number): Promise<void> {
    return Promise.reject(erofs(path));
  }

  symlink(_target: string, linkPath: string): Promise<void> {
    return Promise.reject(erofs(linkPath));
  }

  link(_existingPath: string, newPath: string): Promise<void> {
    return Promise.reject(erofs(newPath));
  }

  readlink(path: string): Promise<string> {
    return this.inner.readlink(path);
  }

  lstat(path: string): Promise<FsStat> {
    return this.inner.lstat(path);
  }

  realpath(path: string): Promise<string> {
    return this.inner.realpath(path);
  }

  utimes(path: string, _atime: Date, _mtime: Date): Promise<void> {
    return Promise.reject(erofs(path));
  }
}

function erofs(path: string): NodeJS.ErrnoException {
  const err = new Error(`EROFS: read-only file system, ${path}`) as NodeJS.ErrnoException;
  err.code = "EROFS";
  err.errno = -30;
  err.syscall = "write";
  err.path = path;
  return err;
}
