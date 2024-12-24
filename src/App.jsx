import './App.css'
import {Routes, Route} from 'react-router-dom'
import NavBar from "./components/NavBar";
import Home from './routes/Home'
import Shop from './routes/Shop'
function App() {

  return (
    <>
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path='/shop' element={<Shop />} />
        <Route path='/#' element={<Home />} />
      </Routes>     
    </>
  )
}

export default App
