{
  description = "fbrv.github.io — Hugo personal site";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.hugo
            pkgs.git
          ];

          shellHook = ''
            echo "Hugo $(hugo version)"
          '';
        };

        packages.default = pkgs.stdenv.mkDerivation {
          name = "fbrv-github-io";
          src = ./.;

          nativeBuildInputs = [ pkgs.hugo pkgs.git ];

          buildPhase = ''
            hugo --minify
          '';

          installPhase = ''
            cp -r public $out
          '';
        };
      }
    );
}
