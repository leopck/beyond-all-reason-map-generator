import argparse
import ctypes
import json
import os
import shutil
import statistics
import sys
from pathlib import Path


def bind(dll, name, restype, *argtypes):
    fn = getattr(dll, name)
    fn.restype = restype
    fn.argtypes = list(argtypes)
    return fn


def decode(value):
    return value.decode("utf-8", errors="replace") if value else ""


def main():
    parser = argparse.ArgumentParser(description="Validate a BAR map with Recoil unitsync")
    parser.add_argument("map", help="Map filename or display name substring")
    parser.add_argument("--archive", help="Explicit .sd7 archive to add before discovery")
    parser.add_argument("--cleanup-staged", action="store_true", help="Remove the staged archive after validation")
    parser.add_argument(
        "--bar-data",
        default=r"C:\Program Files\Beyond-All-Reason\data",
        help="BAR data directory",
    )
    parser.add_argument("--engine", help="Engine directory containing unitsync.dll")
    args = parser.parse_args()

    data_dir = Path(args.bar_data).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    staged_archive = None
    if args.archive:
        maps_dir = data_dir / "maps"
        maps_dir.mkdir(parents=True, exist_ok=True)
        archive_source = Path(args.archive).resolve()
        staged_archive = maps_dir / archive_source.name
        shutil.copy2(archive_source, staged_archive)
    if args.engine:
        engine_dir = Path(args.engine).resolve()
    else:
        engines = sorted((data_dir / "engine").glob("recoil_*"))
        if not engines:
            raise SystemExit(f"no recoil engine found under {data_dir / 'engine'}")
        engine_dir = engines[-1]

    dll_path = engine_dir / "unitsync.dll"
    if not dll_path.exists():
        raise SystemExit(f"missing {dll_path}")

    os.environ["SPRING_DATADIR"] = str(data_dir)
    os.environ["SPRING_WRITEDIR"] = str(data_dir)
    os.chdir(engine_dir)
    if hasattr(os, "add_dll_directory"):
        os.add_dll_directory(str(engine_dir))
    dll = ctypes.WinDLL(str(dll_path))
    os.chdir(data_dir)

    init = bind(dll, "Init", ctypes.c_int, ctypes.c_bool, ctypes.c_int)
    uninit = bind(dll, "UnInit", None)
    set_config_file = bind(dll, "SetSpringConfigFile", None, ctypes.c_char_p)
    set_config_string = bind(dll, "SetSpringConfigString", None, ctypes.c_char_p, ctypes.c_char_p)
    get_next_error = bind(dll, "GetNextError", ctypes.c_char_p)
    get_map_count = bind(dll, "GetMapCount", ctypes.c_int)
    get_data_directory_count = bind(dll, "GetDataDirectoryCount", ctypes.c_int)
    get_data_directory = bind(dll, "GetDataDirectory", ctypes.c_char_p, ctypes.c_int)
    get_map_name = bind(dll, "GetMapName", ctypes.c_char_p, ctypes.c_int)
    get_minimap = bind(
        dll,
        "GetMinimap",
        ctypes.POINTER(ctypes.c_ushort),
        ctypes.c_char_p,
        ctypes.c_int,
    )
    get_info_map_size = bind(
        dll,
        "GetInfoMapSize",
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_char_p,
        ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_int),
    )
    get_info_map = bind(
        dll,
        "GetInfoMap",
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_char_p,
        ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_int,
    )
    add_archive = bind(dll, "AddArchive", None, ctypes.c_char_p)

    result = {
        "engine": str(engine_dir),
        "dataDir": str(data_dir),
        "query": args.map,
        "issues": [],
    }
    initialized = False
    try:
        config_file = Path(__file__).resolve().parent.parent / ".validation" / "unitsync-springsettings.cfg"
        config_file.parent.mkdir(parents=True, exist_ok=True)
        config_file.write_text("", encoding="utf-8")
        set_config_file(str(config_file).encode("utf-8"))
        set_config_string(b"SpringData", str(data_dir).encode("utf-8"))
        initialized = bool(init(False, 0))
        if not initialized:
            result["issues"].append("unitsync Init failed")
        if staged_archive:
            result["archive"] = str(staged_archive)
            add_archive(str(staged_archive).encode("utf-8"))
        count = get_map_count()
        result["mapCount"] = count
        result["dataDirectories"] = [decode(get_data_directory(index)) for index in range(get_data_directory_count())]
        query = args.map.casefold()
        matches = []
        for index in range(count):
            name = decode(get_map_name(index))
            if query in name.casefold() or query in Path(name).stem.casefold():
                matches.append(name)
        result["matches"] = matches
        if not matches:
            if staged_archive:
                map_name = args.map
                result["enumerationWarning"] = "map was not enumerated; validating explicit archive name"
            else:
                result["issues"].append("map was not discovered by unitsync")
                map_name = None
        else:
            map_name = matches[0]
        if map_name:
            encoded_name = map_name.encode("utf-8")
            minimap_ptr = get_minimap(encoded_name, 0)
            if not minimap_ptr:
                result["issues"].append("unitsync could not extract the minimap")
            else:
                samples = [minimap_ptr[index] for index in range(0, 1024 * 1024, 64)]
                result["minimap"] = {
                    "sampleCount": len(samples),
                    "uniqueColors": len(set(samples)),
                    "variance": statistics.pvariance(samples),
                }
                if len(set(samples)) < 16:
                    result["issues"].append("minimap is blank or nearly uniform")

            width = ctypes.c_int()
            height = ctypes.c_int()
            if get_info_map_size(encoded_name, b"height", ctypes.byref(width), ctypes.byref(height)):
                result["heightInfo"] = {"width": width.value, "height": height.value}
                byte_count = width.value * height.value * 2
                height_bytes = (ctypes.c_ubyte * byte_count)()
                if get_info_map(encoded_name, b"height", height_bytes, 2):
                    value_count = width.value * height.value
                    if value_count > 0:
                        values = ctypes.cast(height_bytes, ctypes.POINTER(ctypes.c_ushort))
                        stride = max(1, value_count // 65536)
                        sampled = [values[index] for index in range(0, value_count, stride)]
                        result["heightInfo"].update(
                            min=min(sampled),
                            max=max(sampled),
                            mean=sum(sampled) / len(sampled),
                        )
                    else:
                        result["issues"].append("unitsync returned an empty height info map")
                else:
                    result["issues"].append("unitsync could not extract height data")
            else:
                result["issues"].append("unitsync did not expose a height info map")

        errors = []
        while True:
            error = decode(get_next_error())
            if not error:
                break
            errors.append(error)
        result["unitsyncErrors"] = errors
        result["issues"].extend(errors)
    finally:
        if initialized:
            uninit()
        if args.cleanup_staged and staged_archive and staged_archive.exists():
            staged_archive.unlink()
        if 'config_file' in locals() and config_file.exists():
            config_file.unlink()

    print(json.dumps(result, indent=2))
    return 1 if result["issues"] else 0


if __name__ == "__main__":
    sys.exit(main())
