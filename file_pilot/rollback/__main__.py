def main(argv: list[str] | None = None) -> int:
    _ = argv
    raise SystemExit("CLI rollback entrypoint has been removed. Use the desktop workspace or API instead.")


if __name__ == "__main__":
    raise SystemExit(main())
