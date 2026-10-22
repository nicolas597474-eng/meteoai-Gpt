import {useLocation} from '@/contexts/LocationContext';
import NetatmoStations from '@/components/NetatmoStationsPanel';
export default function StationsPage(){
 const {activeLocation}=useLocation();
 return <NetatmoStations lat={activeLocation?.lat??50.7567} lon={activeLocation?.lon??2.5204} locationName={activeLocation?.name??'Hondeghem'}/>;
}
