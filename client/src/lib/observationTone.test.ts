import { describe, expect, it } from "vitest";
import {
  getApparentTempTone,
  getCloudCoverTone,
  getHumidityTone,
  getPrecipitationTone,
  getPressureTone,
  getVisibilityTone,
  getUvTone,
  getWindGustTone,
  getWindSpeedTone,
} from "./observationTone";

describe("code couleur des observations actuelles", () => {
  it("colore le ressenti du violet (froid extrême) au rouge (canicule)", () => {
    expect(getApparentTempTone(-15).level).toBe("froidExtreme");
    expect(getApparentTempTone(-2).level).toBe("gel");
    expect(getApparentTempTone(14).level).toBe("agreable");
    expect(getApparentTempTone(25).level).toBe("tresAgreable");
    expect(getApparentTempTone(31).level).toBe("chaud");
    expect(getApparentTempTone(35).level).toBe("tresChaud");
    expect(getApparentTempTone(39).level).toBe("canicule");
  });

  it("affiche 0,0 mm de précipitations en bleu puis approfondit avec l'intensité", () => {
    expect(getPrecipitationTone(0).level).toBe("aucune");
    expect(getPrecipitationTone(0).value).toBe("text-blue-300");
    expect(getPrecipitationTone(0.5).level).toBe("tresFaible");
    expect(getPrecipitationTone(2).level).toBe("faible");
    expect(getPrecipitationTone(6).level).toBe("moderee");
    expect(getPrecipitationTone(12).level).toBe("forte");
    expect(getPrecipitationTone(20).level).toBe("tresForte");
  });

  it("colore le vent et les rafales du vert calme au rosé destructeur", () => {
    expect(getWindSpeedTone(8).level).toBe("tresLegere");
    expect(getWindSpeedTone(25).level).toBe("legere");
    expect(getWindSpeedTone(40).level).toBe("moderee");
    expect(getWindSpeedTone(55).level).toBe("forte");
    expect(getWindSpeedTone(70).level).toBe("tresForte");
    expect(getWindSpeedTone(90).level).toBe("violente");

    expect(getWindGustTone(25).level).toBe("calme");
    expect(getWindGustTone(45).level).toBe("moderee");
    expect(getWindGustTone(65).level).toBe("forte");
    expect(getWindGustTone(85).level).toBe("tresForte");
    expect(getWindGustTone(105).level).toBe("severe");
    expect(getWindGustTone(130).level).toBe("destructrice");
  });

  it("colore la pression en vert autour de la normale et en rosé quand elle s'effondre", () => {
    expect(getPressureTone(985).level).toBe("tresBasse");
    expect(getPressureTone(1005).level).toBe("basse");
    expect(getPressureTone(1013).level).toBe("normale");
    expect(getPressureTone(1013).value).toBe("text-emerald-300");
    expect(getPressureTone(1027).level).toBe("haute");
    expect(getPressureTone(1035).level).toBe("tresHaute");
  });

  it("colore l'humidité du ambre sec au bleu saturé", () => {
    expect(getHumidityTone(20).level).toBe("tresSec");
    expect(getHumidityTone(40).level).toBe("sec");
    expect(getHumidityTone(55).level).toBe("confortable");
    expect(getHumidityTone(70).level).toBe("humide");
    expect(getHumidityTone(87).level).toBe("tresHumide");
    expect(getHumidityTone(95).level).toBe("sature");
  });

  it("colore les nuages du bleu dégagé au gris couvert", () => {
    expect(getCloudCoverTone(5).level).toBe("degage");
    expect(getCloudCoverTone(33).level).toBe("partiellementNuageux");
    expect(getCloudCoverTone(75).level).toBe("nuageux");
    expect(getCloudCoverTone(100).level).toBe("couvert");
  });

  it("colore la visibilité du rosé brouillard au bleu clair excellente", () => {
    expect(getVisibilityTone(0.5).level).toBe("brouillardDense");
    expect(getVisibilityTone(2).level).toBe("brume");
    expect(getVisibilityTone(7).level).toBe("reduite");
    expect(getVisibilityTone(15).level).toBe("bonne");
    expect(getVisibilityTone(30).level).toBe("excellente");
  });

  it("colore l'indice UV selon l'échelle OMS, en vert quand il est faible", () => {
    expect(getUvTone(0).level).toBe("faible");
    expect(getUvTone(0).value).toBe("text-green-400");
    expect(getUvTone(4).level).toBe("modere");
    expect(getUvTone(6).level).toBe("eleve");
    expect(getUvTone(9).level).toBe("tresEleve");
    expect(getUvTone(12).level).toBe("extreme");
    expect(getUvTone(null).value).toBe("text-white");
  });

  it("garde un repli neutre blanc quand une donnée est absente", () => {
    expect(getApparentTempTone(null).value).toBe("text-white");
    expect(getPrecipitationTone(undefined).value).toBe("text-white");
    expect(getWindSpeedTone(Number.NaN).value).toBe("text-white");
    expect(getPressureTone(null).value).toBe("text-white");
    expect(getHumidityTone(undefined).value).toBe("text-white");
    expect(getVisibilityTone(null).value).toBe("text-white");
    expect(getCloudCoverTone(Number.NaN).value).toBe("text-white");
    expect(getWindGustTone(null).value).toBe("text-white");
  });

  it("n'utilise que des classes de texte lisibles sur fond sombre, sans halo", () => {
    const tones = [
      getApparentTempTone(20),
      getPrecipitationTone(3),
      getWindSpeedTone(50),
      getWindGustTone(80),
      getPressureTone(1015),
      getHumidityTone(87),
      getCloudCoverTone(40),
      getVisibilityTone(12),
    ];

    for (const item of tones) {
      expect(item.value).toMatch(/^text-(?:sky|cyan|emerald|lime|amber|orange|red|rose|purple|indigo|violet|blue|slate)-\d{3}$/);
      expect(item.value).not.toMatch(/(?:drop-)?shadow-\[/);
    }
  });
});

