function ImgBrand({src, alt, height}) {
   return (
       <div className="col mt-3">
           <img src={src} alt={alt} height={height}  />
       </div>
   );
}
export default ImgBrand;