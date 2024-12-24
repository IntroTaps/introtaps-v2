import Marquee from "react-fast-marquee";
import ImgBrand from "../components/ImgBrand";
function Brands() {
return (
    <>
        <div className="text-center mt-5">
            <h2 className="heading-bold-1 ">Trusted By:</h2>
            <Marquee gradient="true" gradientColor="rgb(231, 231, 231)" pauseOnHover="true"  speed={80}>
                <div className="row justify-content-between align-items-center">
                    <ImgBrand src="/brandlogo2.png" alt="" height={50} />
                    <ImgBrand src="/brandlogo3.png" alt="" height={85} />
                    <ImgBrand src="/brandlogo4.png" alt="" height={65} />
                    <ImgBrand src="/brand5.png" alt="" height={40} />
                    <ImgBrand src="/img/teenverselogo.png" alt="" height={60} />
                    <ImgBrand src="/img/eduvision.webp" alt="" height={60} />
                    <ImgBrand src="/img/nafslogo.png" alt="" height={70} />
                    <ImgBrand src="/brandlogo2.png" alt="" height={50} />
                    <ImgBrand src="/brandlogo3.png" alt="" height={85} />
                    <ImgBrand src="/brandlogo4.png" alt="" height={65} />
                    <ImgBrand src="/brand5.png" alt="" height={40} />
                    <ImgBrand src="/img/teenverselogo.png" alt="" height={60} />
                    <ImgBrand src="/img/eduvision.webp" alt="" height={60} />
                    <ImgBrand src="/img/nafslogo.png" alt="" height={70} />
                </div>
          </Marquee>
          <br />
   
        </div>
    </>
);
}   
export default Brands;