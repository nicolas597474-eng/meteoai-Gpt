import {QueryClient, QueryObserver} from '@tanstack/react-query';
import {describe, expect, it} from 'vitest';
import {stationOverviewPlaceholder} from '@shared/stationEvidencePresentation';

describe('changement de période des relevés', () => {
  it('garde la page montée pendant le chargement, puis remplace la période réelle', async () => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0, staleTime: Infinity}}});
    const context = {lat: 50.7567, lon: 2.5204, radiusKm: 20};
    const day = {center: {lat: context.lat, lon: context.lon}, radiusKm: context.radiusKm, periodDays: 1};
    const week = {...day, periodDays: 7};
    const placeholderData = (previous: typeof day | undefined) => stationOverviewPlaceholder(previous, context);
    client.setQueryData(['overview', context, 1], day);
    const observer = new QueryObserver(client, {queryKey: ['overview', context, 1], queryFn: async () => day, placeholderData});
    const unsubscribe = observer.subscribe(() => {});
    let finish!: (value: typeof day) => void;
    const pending = new Promise<typeof day>(resolve => {finish = resolve;});
    try {
      observer.setOptions({queryKey: ['overview', context, 7], queryFn: () => pending, placeholderData});
      expect(observer.getCurrentResult()).toMatchObject({isLoading: false, isPlaceholderData: true, data: day});
      finish(week); await pending; await observer.refetch();
      expect(observer.getCurrentResult()).toMatchObject({isPlaceholderData: false, data: week});
    } finally {unsubscribe(); observer.destroy(); client.clear();}
  });

  it('ne réutilise pas les relevés précédents pour un autre lieu, un autre rayon ou une réponse absente', () => {
    const previous = {center: {lat: 50.7567, lon: 2.5204}, radiusKm: 20, periodDays: 1};
    expect(stationOverviewPlaceholder(previous, {...previous.center, radiusKm: 50})).toBeUndefined();
    expect(stationOverviewPlaceholder(previous, {lat: 48.8, lon: 2.3, radiusKm: 20})).toBeUndefined();
    expect(stationOverviewPlaceholder(undefined, {...previous.center, radiusKm: 20})).toBeUndefined();
  });
});
